const express = require("express");
const { createEvalSession, switchEvalPersona } = require("../middleware/mode_policy");

const router = express.Router();

router.post("/session", createEvalSession);
router.post("/persona", switchEvalPersona);

module.exports = router;
