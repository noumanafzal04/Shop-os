<?php

namespace App\Http\Middleware;

use App\Models\AnsweredRequest;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ONE PRESS, ONE RECORD — whatever the button does in between.
 *
 * A form that moves money sends an `idempotency_key` minted when it opened.
 * The first request with it is let through and its answer kept; the same key
 * again is given that answer back and nothing is written twice. A second
 * press that lands while the first is still being written is told so (409
 * REQUEST_IN_FLIGHT) — the first one is the record. A refusal is not kept:
 * the person fixes the form and sends the same key again.
 *
 * Tester pass 1 (B07): khata payment, supplier payment and expense were each
 * recorded twice by a double-click.
 */
class AnswerOnce
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key') ?? $request->input('idempotency_key');
        $user = $request->user();

        if ($request->isMethodSafe() || ! is_string($key) || $key === '' || $user === null) {
            return $next($request);
        }

        $where = ['user_id' => $user->id, 'key' => mb_substr($key, 0, 100)];
        $route = $request->method().' '.$request->path();

        // The unique (user, key) is the lock: the first press takes the row,
        // every later one — however close behind — is turned to its answer.
        try {
            $row = AnsweredRequest::query()->create($where + ['route' => $route, 'tenant_id' => $user->tenant_id]);
        } catch (UniqueConstraintViolationException) {
            return $this->again(AnsweredRequest::query()->where($where)->firstOrFail(), $route);
        }

        $response = $next($request);

        if ($response->isSuccessful()) {
            $row->update(['status' => $response->getStatusCode(), 'body' => $response->getContent()]);
        } else {
            $row->delete();
        }

        return $response;
    }

    private function again(AnsweredRequest $seen, string $route): Response
    {
        if ($seen->route !== $route) {
            return $this->refuse(422, 'That key was already used for something else — reopen the form and try again.', 'IDEMPOTENCY_KEY_REUSED');
        }
        if ($seen->status === null) {
            return $this->refuse(409, 'This is already being recorded — one moment.', 'REQUEST_IN_FLIGHT');
        }

        return response((string) $seen->body, (int) $seen->status, ['Content-Type' => 'application/json', 'Idempotent-Replay' => 'true']);
    }

    private function refuse(int $status, string $message, string $code): Response
    {
        return response()->json([
            'success' => false, 'message' => $message, 'data' => null, 'errors' => (object) [],
            'meta' => ['error_code' => $code],
        ], $status);
    }
}
