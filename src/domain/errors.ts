export class EscribanoError extends Error {
  constructor(
    message: string,
    protected code: string
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'EscribanoError';
  }

  get errorCode(): string {
    return this.code;
  }
}

export class PipelineError extends EscribanoError {
  constructor(
    message: string,
    public readonly step: string
  ) {
    super(message, 'PIPELINE_ERROR');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'PipelineError';
  }
}

export class AdapterError extends EscribanoError {
  constructor(
    message: string,
    public readonly adapter: string
  ) {
    super(message, 'ADAPTER_ERROR');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'AdapterError';
  }
}

export class ModelError extends AdapterError {
  constructor(
    message: string,
    adapter: string,
    public readonly model: string
  ) {
    super(message, adapter);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ModelError';
    this.code = 'MODEL_ERROR';
  }
}

export class ConfigError extends EscribanoError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ConfigError';
  }
}
