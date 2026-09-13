/**
 * ECDAT Domain Layer
 * Pure domain contracts, entities, and value objects decoupled from transport and persistence.
 */

const contracts = require("./contracts");
const identity = require("./identity");
const errors = require("./errors");

module.exports = {
  ...contracts,
  ...identity,
  ...errors,
};
