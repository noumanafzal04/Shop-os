<?php

namespace App\Exceptions;

use Exception;

/**
 * Business-rule violation carrying an HTTP status and a machine-readable
 * error code. Rendered into the standard envelope in bootstrap/app.php.
 */
class DomainException extends Exception
{
    public function __construct(
        string $message,
        public readonly int $status = 400,
        public readonly ?string $errorCode = null,
    ) {
        parent::__construct($message);
    }

    public static function unauthorized(string $message = 'Invalid credentials.', ?string $code = 'INVALID_CREDENTIALS'): self
    {
        return new self($message, 401, $code);
    }

    public static function forbidden(string $message, ?string $code = 'FORBIDDEN'): self
    {
        return new self($message, 403, $code);
    }

    public static function conflict(string $message, ?string $code = 'CONFLICT'): self
    {
        return new self($message, 409, $code);
    }

    public static function unprocessable(string $message, ?string $code = null): self
    {
        return new self($message, 422, $code);
    }
}
