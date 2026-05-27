export const KNOWN_SUBJECT_CODES = ['CO102', 'SE102', 'SE104', 'AM102'];
export const TIMETABLE_TIME_OPTIONS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
export const TIMETABLE_DURATION_OPTIONS = [1, 2, 3, 4];


const DEBUG_PARSER = true; 

const DAY_NAME_LOOKUP = {
  mon: 'Monday', monday: 'Monday',
  tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
  wed: 'Wednesday', weds: 'Wednesday', wednesday: 'Wednesday',
  thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
  fri: 'Friday', friday: 'Friday',
};
const DAY_PATTERN = /\b(mon(?:day)?|tue(?:s|sday|day)?|wed(?:s|nesday)?|thu(?:r|rs|rsday|day)?|fri(?:day)?)\b/gi;
const TIME_RANGE_PATTERN = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi;
const SUBJECT_CODE_PATTERN = /\b[A-Z]{1,5}\s*-?\s*[0-9IOQL]{2,4}[A-Z]?(?:\s*\(\s*L\s*\)|\s+L\b)?(?=$|[^A-Z0-9])/gi;
const SKIP_SUBJECT_PATTERN = /^(?:LAB|CL|PL|WL|ROOM|LT|CR|BATCH|GROUP|SEC|SECTION)\d{0,3}$/i;
const LAB_INDICATOR_PATTERN = /\b(lab|practical|workshop)\b|\b(?:lab|cl|pl|wl)\s*-?\s*\d{1,3}\b|\b(?:computer|physics|chemistry|electronics|mechanical)\s+lab\b|\(\s*l\s*\)/i;

function log_debug(message, data = null) {
  if (!DEBUG_PARSER) return;
  console.log(`[Parser Debug] ${message}`, data !== null ? data : '');
}


export function reconstruct_grid_from_bboxes(words) {
  if (!words || !words.length) return '';
  
  words.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  
  let lines = [];
  let current_line = [words[0]];
  let line_y_center = (words[0].bbox.y0 + words[0].bbox.y1) / 2;

  for (let i = 1; i < words.length; i++) {
    let w = words[i];
    let w_center = (w.bbox.y0 + w.bbox.y1) / 2;
    if (Math.abs(w_center - line_y_center) < (w.bbox.y1 - w.bbox.y0) * 0.5) {
      current_line.push(w);
      line_y_center = ((line_y_center * (current_line.length - 1)) + w_center) / current_line.length;
    } else {
      lines.push(current_line);
      current_line = [w];
      line_y_center = w_center;
    }
  }
  lines.push(current_line);

  const grid_text = lines.map(line => {
    line.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let line_str = '';
    let last_x = line[0].bbox.x0;
    line.forEach(w => {
      let gap = w.bbox.x0 - last_x;
      
      if (gap > 20) line_str += ' '.repeat(Math.min(10, Math.ceil(gap / 15)));
      else if (gap > 5) line_str += ' ';
      
      line_str += w.text;
      last_x = w.bbox.x1;
    });
    return line_str.trim();
  }).join('\n');

  log_debug('Reconstructed OCR Grid:\n', grid_text);
  return grid_text;
}


export function normalize_timetable_ocr_text(raw_text_value) {
  const normalized = String(raw_text_value || '')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[|¦]/g, ' ')
    
    .replace(/[ \t]+/g, ' ') 
    .replace(/ \n /g, '\n')
    .replace(/\n+/g, '\n')
    
    .replace(/\b([A-Za-z]{1,5})[ \t]+([0-9IOQL]{2,4}[A-Za-z]?)\b/g, '$1$2')
   
    .replace(/\b(C[O0]|S[E3]|A[MIVI])([0-9IOQL]{2,4})\b/ig, (match, prefix, suffix) => {
       const cleanPrefix = prefix.replace(/0/g, 'O').replace(/3/g, 'E').replace(/I|V/g, 'M');
       const cleanSuffix = suffix.replace(/[OQ]/gi, '0').replace(/[IL]/gi, '1');
       return cleanPrefix + cleanSuffix;
    })
    .trim()
    .toUpperCase();
    
  log_debug('Normalized Text:\n', normalized);
  return normalized;
}

function normalize_code_shape(code_value) {
  return String(code_value || '').toUpperCase().replace(/\(\s*L\s*\)$/i, '').replace(/[^A-Z0-9]/g, '');
}

function normalize_code_digits(code_value) {
  const compact_code = normalize_code_shape(code_value);
  return compact_code.replace(/[IOQL]/g, char => (char === 'O' || char === 'Q' ? '0' : '1'));
}

function normalize_known_subject_codes(extra_known_subject_codes = []) {
  return [...KNOWN_SUBJECT_CODES, ...extra_known_subject_codes]
    .map(normalize_code_shape)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function levenshtein_distance(first_value, second_value) {
  const first_text = String(first_value || '');
  const second_text = String(second_value || '');
  const distances = Array.from({ length: first_text.length + 1 }, (_, i) => [i]);
  for (let i = 0; i <= second_text.length; i++) distances[0][i] = i;
  for (let i = 1; i <= first_text.length; i++) {
    for (let j = 1; j <= second_text.length; j++) {
      const cost = first_text[i - 1] === second_text[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost
      );
    }
  }
  return distances[first_text.length][second_text.length];
}

function find_best_known_subject_match(raw_candidate_value, known_subject_codes) {
  const normalized_candidate = normalize_code_shape(raw_candidate_value);
  const digit_normalized = normalize_code_digits(raw_candidate_value);
  let best_match = null;
  let best_score = Number.POSITIVE_INFINITY;
  
  known_subject_codes.forEach(known_code => {
    const known_digit = normalize_code_digits(known_code);
    const score = Math.min(
      levenshtein_distance(normalized_candidate, known_code),
      levenshtein_distance(digit_normalized, known_digit)
    );
    if (score < best_score) { best_score = score; best_match = known_code; }
  });
  
  return best_score <= (normalized_candidate.length <= 5 ? 1 : 2) ? best_match : null;
}

function normalize_subject_code_for_import(raw_subject_text, known_subject_codes) {
  const compact = normalize_code_shape(raw_subject_text);
  const known_match = find_best_known_subject_match(compact, known_subject_codes);
  if (known_match) return known_match;
  
  const fallback = compact.match(/^([A-Z]{1,5})([0-9IOQL]{2,4}[A-Z]?)$/);
  if (!fallback) return compact;
  const digits = fallback[2].replace(/[IOQL]/g, v => (v === 'O' || v === 'Q' ? '0' : '1'));
  return `${fallback[1]}${digits}`;
}

function parse_clock_token_to_hour(clock_token_string) {
  const parts = String(clock_token_string || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!parts) return null;
  let hour = parseInt(parts[1], 10);
  const meridiem = parts[3]?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  return hour;
}

export function parse_time_range_from_text(time_range_text_value) {
  const normalized = String(time_range_text_value || '').replace(/\s+/g, '').replace(/to/i, '-');
  const match = normalized.match(/(\d{1,2}(?::\d{2})?(?:am|pm)?)[-](\d{1,2}(?::\d{2})?(?:am|pm)?)/i);
  if (!match) return null;
  const start = parse_clock_token_to_hour(match[1]);
  let end = parse_clock_token_to_hour(match[2]);
  if (start === null || end === null) return null;
  if (end <= start) end += 12;
  const duration = Math.max(1, Math.min(4, Math.round(end - start)));
  if (!TIMETABLE_TIME_OPTIONS.includes(start)) return null;
  return { startHour: start, duration };
}


function get_spatial_position(text, index) {
  const text_before = text.substring(0, index);
  const lines = text_before.split('\n');
  return {
    line: lines.length - 1,
    col: lines[lines.length - 1].length
  };
}

function detect_day_tokens(normalized_text_value) {
  const days = [];
  let match;
  while ((match = DAY_PATTERN.exec(normalized_text_value)) !== null) {
    const pos = get_spatial_position(normalized_text_value, match.index);
    days.push({ day: DAY_NAME_LOOKUP[match[1].toLowerCase()], index: match.index, ...pos });
  }
  DAY_PATTERN.lastIndex = 0;
  log_debug('Detected Days:', days);
  return days;
}

function detect_time_tokens(normalized_text_value) {
  const times = [];
  let match;
  while ((match = TIME_RANGE_PATTERN.exec(normalized_text_value)) !== null) {
    const parsed = parse_time_range_from_text(match[0]);
    if (parsed) {
      const pos = get_spatial_position(normalized_text_value, match.index);
      times.push({ ...parsed, index: match.index, text: match[0], ...pos });
    }
  }
  TIME_RANGE_PATTERN.lastIndex = 0;
  log_debug('Detected Times:', times);
  return times;
}

export function does_timetable_text_indicate_lab(text_value) {
  const text = String(text_value || '').toUpperCase();
  if (/\bTUT(?:ORIAL)?\b/.test(text)) {
    return LAB_INDICATOR_PATTERN.test(text.replace(/\bTUT(?:ORIAL)?\b/g, ''));
  }
  return LAB_INDICATOR_PATTERN.test(text);
}

function detect_subject_mentions(normalized_text_value, known_subject_codes) {
  const subjects = [];
  let match;
  while ((match = SUBJECT_CODE_PATTERN.exec(normalized_text_value)) !== null) {
    const raw = match[0];
    const compact = normalize_code_shape(raw);
    if (SKIP_SUBJECT_PATTERN.test(compact)) continue;
    
    const code = normalize_subject_code_for_import(raw, known_subject_codes);
    if (code) {
      
      const lineStart = normalized_text_value.lastIndexOf('\n', match.index) + 1;
      let lineEnd = normalized_text_value.indexOf('\n', match.index);
      if(lineEnd === -1) lineEnd = normalized_text_value.length;
      const lineText = normalized_text_value.substring(lineStart, lineEnd);
      
      const pos = get_spatial_position(normalized_text_value, match.index);
      subjects.push({
        subjectCode: code,
        index: match.index,
        text: raw,
        explicitLab: does_timetable_text_indicate_lab(lineText),
        ...pos
      });
    }
  }
  SUBJECT_CODE_PATTERN.lastIndex = 0;
  log_debug('Detected Subjects:', subjects);
  return subjects;
}


function find_spatial_day(subject, days) {
  
  const sameLine = days.find(d => d.line === subject.line);
  if (sameLine) return sameLine;
  
 
  const previousDays = days.filter(d => d.line <= subject.line).sort((a, b) => b.line - a.line);
  return previousDays.length > 0 ? previousDays[0] : days[0];
}

function find_spatial_time(subject, times) {
  if (times.length === 0) return null;


  const sameLine = times.find(t => t.line === subject.line);
  if (sameLine) return sameLine;


  const headers = times.filter(t => t.line < subject.line);
  if (headers.length > 0) {
    
    return headers.reduce((closest, current) => {
      const currentDist = Math.abs(current.col - subject.col);
      const closestDist = Math.abs(closest.col - subject.col);
      return (currentDist < closestDist) ? current : closest;
    });
  }

 
  return times.reduce((closest, current) => 
    Math.abs(current.index - subject.index) < Math.abs(closest.index - subject.index) ? current : closest
  );
}

function parse_subject_entries_globally(subject_tokens, day_tokens, time_tokens) {
  const entries = [];
  subject_tokens.forEach(subject => {
    let day = find_spatial_day(subject, day_tokens);
    let time = find_spatial_time(subject, time_tokens);
    
    if (day && time) {
      const baseCode = subject.subjectCode.replace(/\(L\)$/i, '');
      entries.push({
        subjectCode: subject.explicitLab ? `${baseCode}(L)` : baseCode,
        type: subject.explicitLab ? 'lab' : 'theory',
        day: day.day,
        startHour: time.startHour,
        duration: time.duration,
        rawText: subject.text,
      });
    }
  });
  return entries;
}

function dedupe_timetable_import_entries(entries_array) {
  const seen = new Set();
  return entries_array.filter(entry => {
    const key = [entry.subjectCode, entry.type, entry.day, entry.startHour, entry.duration].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parse_timetable_text_to_entries(raw_text_value, options = {}) {
  log_debug('--- STARTING PARSER ---');
  const known_codes = normalize_known_subject_codes(options.knownSubjectCodes || []);
  const normalized_text = normalize_timetable_ocr_text(raw_text_value);
  
  const detected_days = detect_day_tokens(normalized_text);
  const detected_times = detect_time_tokens(normalized_text);
  const detected_subjects = detect_subject_mentions(normalized_text, known_codes);

  const final_entries = dedupe_timetable_import_entries(
    parse_subject_entries_globally(detected_subjects, detected_days, detected_times)
  );
  
  log_debug('--- FINAL PARSED ENTRIES ---', final_entries);
  return final_entries;
}