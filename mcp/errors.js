export class MoomoraUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoomoraUnavailableError';
  }
}

export class MoomoraApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MoomoraApiError';
    this.status = status;
  }
}
