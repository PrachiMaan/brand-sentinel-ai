/**
 * BrandSentinel sidebar for Google Docs.
 *
 * Talks to the BrandSentinel Review API (v1) with an API key stored in the
 * user's properties. Nothing is written into the document except highlight
 * colours when the reviewer asks for them.
 */

var PROPS = PropertiesService.getUserProperties();
var MAX_BODY_CHARS = 20000;
var MAX_POLLS = 20;

function onOpen() {
  DocumentApp.getUi()
    .createMenu('BrandSentinel')
    .addItem('Open review panel', 'showSidebar')
    .addItem('Clear highlights', 'clearHighlights')
    .addToUi();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle(
    'BrandSentinel review',
  );
  DocumentApp.getUi().showSidebar(html);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function getSettings() {
  return {
    apiBase: PROPS.getProperty('apiBase') || '',
    apiKey: PROPS.getProperty('apiKey') || '',
    configured: Boolean(PROPS.getProperty('apiBase') && PROPS.getProperty('apiKey')),
  };
}

function saveSettings(apiBase, apiKey) {
  var base = String(apiBase || '').trim().replace(/\/+$/, '');
  var key = String(apiKey || '').trim();
  if (!/^https?:\/\//.test(base)) {
    return { ok: false, error: 'API base must start with http:// or https://' };
  }
  if (!key) return { ok: false, error: 'API key is required' };
  PROPS.setProperty('apiBase', base);
  PROPS.setProperty('apiKey', key);
  return { ok: true };
}

function clearSettings() {
  PROPS.deleteProperty('apiBase');
  PROPS.deleteProperty('apiKey');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function api_(path, method, body, idempotencyKey) {
  var settings = getSettings();
  if (!settings.configured) throw new Error('Add your API base URL and key first.');
  var headers = {
    Authorization: 'Bearer ' + settings.apiKey,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  var options = {
    method: method || 'get',
    headers: headers,
    muteHttpExceptions: true,
    // Never replay the bearer key to another host on a redirect.
    followRedirects: false,
  };
  if (body) options.payload = JSON.stringify(body);
  var response = UrlFetchApp.fetch(settings.apiBase + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  var json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = null;
  }
  if (code >= 200 && code < 300) return json;
  var message =
    json && json.error && json.error.message
      ? json.error.message
      : 'Request failed (' + code + ')';
  if (json && json.error && json.error.code) message += ' [' + json.error.code + ']';
  if (code === 429) {
    var retry = response.getHeader('retry-after');
    if (retry) message += ' Retry in ' + retry + ' seconds.';
  }
  throw new Error(message);
}

/** Cheap, stable digest so the same document body reuses the same idempotency key. */
function digest_(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  // The runtime hands back a plain array of signed bytes, a typed array or a
  // bare array-like depending on the version, so walk it by index instead of
  // calling array methods that may coerce the hex strings back to numbers.
  var out = '';
  for (var i = 0; i < raw.length; i++) {
    var b = raw[i];
    var v = ((b < 0 ? b + 256 : b) & 0xff).toString(16);
    out += v.length === 1 ? '0' + v : v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Review flow                                                         */
/* ------------------------------------------------------------------ */

function readDocument() {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var text = body.getText() || '';
  return {
    docId: doc.getId(),
    title: doc.getName(),
    text: text,
  };
}

/**
 * Submits the current document body for review. Returns the run status so the
 * sidebar can start polling.
 */
function submitDocument(channel, team) {
  var doc = readDocument();
  var text = doc.text.trim();
  if (!text) return { ok: false, error: 'This document is empty.' };
  if (text.length > MAX_BODY_CHARS) {
    return {
      ok: false,
      error:
        'Document is ' +
        text.length.toLocaleString() +
        ' characters. The API accepts up to ' +
        MAX_BODY_CHARS.toLocaleString() +
        '.',
    };
  }
  var payload = {
    title: doc.title || 'Google Doc',
    text: text,
    channel: channel || 'instagram',
    audience: 'Google Docs reviewer',
    team: team || 'Social',
    externalRef: doc.docId,
  };
  // The API answers 409 when a key is reused with a different body, so the key
  // has to cover every field: text, channel, team and the document title.
  var idempotencyKey = 'gdoc-' + digest_(doc.docId + ':' + digest_(JSON.stringify(payload))).slice(0, 40);
  try {
    var result = api_('/api/v1/submissions', 'post', payload, idempotencyKey);
    return {
      ok: true,
      submissionId: result.id,
      status: result.status,
      idempotencyKey: idempotencyKey,
      chars: text.length,
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function fetchStatus(submissionId) {
  try {
    return { ok: true, run: api_('/api/v1/submissions/' + encodeURIComponent(submissionId), 'get') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function fetchFindings(submissionId) {
  try {
    var data = api_('/api/v1/submissions/' + encodeURIComponent(submissionId) + '/findings', 'get');
    return { ok: true, findings: (data && data.findings) || [] };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function decideFinding(submissionId, findingId, decision, reason) {
  try {
    var body = { findingId: findingId, decision: decision };
    if (reason) body.reason = reason;
    return {
      ok: true,
      result: api_('/api/v1/submissions/' + encodeURIComponent(submissionId) + '/decision', 'post', body),
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function decideSubmission(submissionId, decision, reason) {
  try {
    var body = { decision: decision };
    if (reason) body.reason = reason;
    return {
      ok: true,
      result: api_('/api/v1/submissions/' + encodeURIComponent(submissionId) + '/decision', 'post', body),
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/* ------------------------------------------------------------------ */
/* Highlights                                                          */
/* ------------------------------------------------------------------ */

var HIGHLIGHT = {
  critical: '#F3C9C4',
  high: '#F6DCC0',
  medium: '#FBEFC2',
  low: '#DDE7D2',
};

/**
 * Finds the quoted span in the current document and colours it. Returns an
 * error when the text has changed since the review, so the sidebar can say so
 * instead of highlighting the wrong sentence.
 */
function highlightSpan(spanText, severity) {
  var needle = String(spanText || '').trim();
  if (!needle) return { ok: false, error: 'This finding has no quoted text.' };
  var body = DocumentApp.getActiveDocument().getBody();
  var found = body.findText(escapeForFind_(needle));
  if (!found) {
    return { ok: false, error: 'text changed, re-run the review' };
  }
  var element = found.getElement();
  var start = found.getStartOffset();
  var end = found.getEndOffsetInclusive();
  element.asText().setBackgroundColor(start, end, HIGHLIGHT[severity] || HIGHLIGHT.medium);
  return { ok: true };
}

function escapeForFind_(text) {
  // DocumentApp.findText takes a regex; escape anything that could be syntax.
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

function clearHighlights() {
  var body = DocumentApp.getActiveDocument().getBody();
  var colours = Object.keys(HIGHLIGHT).map(function (k) {
    return HIGHLIGHT[k];
  });
  var count = 0;
  var text = body.editAsText();
  var content = text.getText();
  for (var i = 0; i < content.length; i++) {
    var bg = text.getBackgroundColor(i);
    if (bg && colours.indexOf(bg.toUpperCase()) >= 0) {
      text.setBackgroundColor(i, i, null);
      count++;
    }
  }
  return { ok: true, cleared: count };
}
