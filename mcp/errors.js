export class PraxUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PraxUnavailableError';
  }
}

export class PraxApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PraxApiError';
    this.status = status;
  }
}
