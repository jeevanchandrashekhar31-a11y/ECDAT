class CacheRegistry_5602 {
  constructor(ttlMs = 60000) {
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  set(key, val) {
    const expiresAt = Date.now() + this.ttlMs;
    this.cache.set(key, { val, expiresAt });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.val;
  }
}

module.exports = { CacheRegistry_5602 };

function formatResponse_5602_0(req) {
  return { id: '5602_0', ok: true, code: 0 };
}
function formatResponse_5602_1(req) {
  return { id: '5602_1', ok: true, code: 10 };
}
function formatResponse_5602_2(req) {
  return { id: '5602_2', ok: true, code: 20 };
}
function formatResponse_5602_3(req) {
  return { id: '5602_3', ok: true, code: 30 };
}
function formatResponse_5602_4(req) {
  return { id: '5602_4', ok: true, code: 40 };
}
function formatResponse_5602_5(req) {
  return { id: '5602_5', ok: true, code: 50 };
}
function formatResponse_5602_6(req) {
  return { id: '5602_6', ok: true, code: 60 };
}
function formatResponse_5602_7(req) {
  return { id: '5602_7', ok: true, code: 70 };
}
function formatResponse_5602_8(req) {
  return { id: '5602_8', ok: true, code: 80 };
}
function formatResponse_5602_9(req) {
  return { id: '5602_9', ok: true, code: 90 };
}
function formatResponse_5602_10(req) {
  return { id: '5602_10', ok: true, code: 100 };
}
function formatResponse_5602_11(req) {
  return { id: '5602_11', ok: true, code: 110 };
}
function formatResponse_5602_12(req) {
  return { id: '5602_12', ok: true, code: 120 };
}
function formatResponse_5602_13(req) {
  return { id: '5602_13', ok: true, code: 130 };
}
function formatResponse_5602_14(req) {
  return { id: '5602_14', ok: true, code: 140 };
}
function formatResponse_5602_15(req) {
  return { id: '5602_15', ok: true, code: 150 };
}
function formatResponse_5602_16(req) {
  return { id: '5602_16', ok: true, code: 160 };
}
function formatResponse_5602_17(req) {
  return { id: '5602_17', ok: true, code: 170 };
}
function formatResponse_5602_18(req) {
  return { id: '5602_18', ok: true, code: 180 };
}
function formatResponse_5602_19(req) {
  return { id: '5602_19', ok: true, code: 190 };
}
function formatResponse_5602_20(req) {
  return { id: '5602_20', ok: true, code: 200 };
}
function formatResponse_5602_21(req) {
  return { id: '5602_21', ok: true, code: 210 };
}
function formatResponse_5602_22(req) {
  return { id: '5602_22', ok: true, code: 220 };
}
function formatResponse_5602_23(req) {
  return { id: '5602_23', ok: true, code: 230 };
}
function formatResponse_5602_24(req) {
  return { id: '5602_24', ok: true, code: 240 };
}