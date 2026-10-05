<?php

namespace App\Exceptions;

use Exception;

/**
 * Business-rule violation carrying an HTTP status and a machine-readable
 * error code. Rendered into the standard envelope in bootstrap/app.php.
 */
class DomainException extends Exception
{
    /**
     * @param  array<string, mixed>  $context  FIGURES A CLIENT CAN ACT ON.
     *
     * A refusal is a sentence for a person and, sometimes, a number for a
     * program. "Amount paid (12,610.00) is less than the total (14,023.94)"
     * is a perfectly good sentence and a till could do nothing with it: the
     * one figure that would let the cashier finish the sale was inside a
     * formatted string. Parsing prose for money is how a comma in a
     * thousands separator becomes a wrong charge.
     *
     * So the figures travel as data, in the envelope's `meta`, beside the
     * `error_code` that says what kind of refusal this is. Empty for every
     * refusal that has nothing to add, which is nearly all of them.
     */
    public function __construct(
        string $message,
        public readonly int $status = 400,
        public readonly ?string $errorCode = null,
        public readonly array $context = [],
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

    /** @param  array<string, mixed>  $context */
    public static function unprocessable(string $message, ?string $code = null, array $context = []): self
    {
        return new self($message, 422, $code, $context);
    }
}
