const { EventEmitter } = require('events');

const asyncJobs = new Map();
const queueEmitter = new EventEmitter();

function createJob(jobId, type, metadata = {}) {
  const job = {
    id: jobId,
    type,
    status: 'processing',
    progress: 0,
    message: 'Initializing...',
    startTime: Date.now(),
    endTime: null,
    result: null,
    error: null,
    ...metadata
  };
  asyncJobs.set(jobId, job);
  return job;
}

function updateJob(jobId, updates) {
  const job = asyncJobs.get(jobId);
  if (job) {
    Object.assign(job, updates);
    if (['completed', 'failed'].includes(job.status)) {
      job.endTime = Date.now();
    }
    queueEmitter.emit(`update:${jobId}`, job);
  }
}

function getJob(jobId) {
  return asyncJobs.get(jobId);
}

module.exports = {
  createJob,
  updateJob,
  getJob,
  queueEmitter
};
