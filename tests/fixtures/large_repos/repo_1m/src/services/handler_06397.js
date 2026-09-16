class CacheRegistry_6397 {
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

module.exports = { CacheRegistry_6397 };

function formatResponse_6397_0(req) {
  return { id: '6397_0', ok: true, code: 0 };
}
function formatResponse_6397_1(req) {
  return { id: '6397_1', ok: true, code: 10 };
}
function formatResponse_6397_2(req) {
  return { id: '6397_2', ok: true, code: 20 };
}
function formatResponse_6397_3(req) {
  return { id: '6397_3', ok: true, code: 30 };
}
function formatResponse_6397_4(req) {
  return { id: '6397_4', ok: true, code: 40 };
}
function formatResponse_6397_5(req) {
  return { id: '6397_5', ok: true, code: 50 };
}
function formatResponse_6397_6(req) {
  return { id: '6397_6', ok: true, code: 60 };
}
function formatResponse_6397_7(req) {
  return { id: '6397_7', ok: true, code: 70 };
}
function formatResponse_6397_8(req) {
  return { id: '6397_8', ok: true, code: 80 };
}
function formatResponse_6397_9(req) {
  return { id: '6397_9', ok: true, code: 90 };
}
function formatResponse_6397_10(req) {
  return { id: '6397_10', ok: true, code: 100 };
}
function formatResponse_6397_11(req) {
  return { id: '6397_11', ok: true, code: 110 };
}
function formatResponse_6397_12(req) {
  return { id: '6397_12', ok: true, code: 120 };
}
function formatResponse_6397_13(req) {
  return { id: '6397_13', ok: true, code: 130 };
}
function formatResponse_6397_14(req) {
  return { id: '6397_14', ok: true, code: 140 };
}
function formatResponse_6397_15(req) {
  return { id: '6397_15', ok: true, code: 150 };
}
function formatResponse_6397_16(req) {
  return { id: '6397_16', ok: true, code: 160 };
}
function formatResponse_6397_17(req) {
  return { id: '6397_17', ok: true, code: 170 };
}
function formatResponse_6397_18(req) {
  return { id: '6397_18', ok: true, code: 180 };
}
function formatResponse_6397_19(req) {
  return { id: '6397_19', ok: true, code: 190 };
}
function formatResponse_6397_20(req) {
  return { id: '6397_20', ok: true, code: 200 };
}
function formatResponse_6397_21(req) {
  return { id: '6397_21', ok: true, code: 210 };
}
function formatResponse_6397_22(req) {
  return { id: '6397_22', ok: true, code: 220 };
}
function formatResponse_6397_23(req) {
  return { id: '6397_23', ok: true, code: 230 };
}
function formatResponse_6397_24(req) {
  return { id: '6397_24', ok: true, code: 240 };
}