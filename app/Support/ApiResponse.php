<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Resources\Json\ResourceCollection;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * Single JSON envelope for every API response:
 * { success, message, data, errors, meta }
 */
class ApiResponse
{
    public static function ok(mixed $data = null, string $message = 'OK', array $meta = []): JsonResponse
    {
        return self::success($data, $message, 200, $meta);
    }

    public static function created(mixed $data = null, string $message = 'Created'): JsonResponse
    {
        return self::success($data, $message, 201);
    }

    public static function noContent(string $message = 'Deleted'): JsonResponse
    {
        return self::success(null, $message, 200);
    }

    /**
     * Paginated payload — meta carries the pagination block.
     */
    /**
     * @param  array<string, mixed>  $meta  extra meta alongside `pagination` —
     *                                      e.g. what the FILTERED set totals,
     *                                      which a page of rows cannot say.
     */
    public static function paginated(
        ResourceCollection|LengthAwarePaginator $items,
        string $message = 'OK',
        array $meta = [],
    ): JsonResponse {
        $paginator = $items instanceof ResourceCollection ? $items->resource : $items;

        return self::success(
            $items instanceof ResourceCollection ? $items->collection : $paginator->items(),
            $message,
            200,
            $meta + [
                'pagination' => [
                    'current_page' => $paginator->currentPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                ],
            ],
        );
    }

    public static function error(string $message, int $status = 400, array $errors = [], ?string $code = null): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $message,
            'data' => null,
            'errors' => (object) $errors,
            'meta' => (object) array_filter(['error_code' => $code]),
        ], $status);
    }

    public static function unauthorized(string $message = 'Unauthenticated.'): JsonResponse
    {
        return self::error($message, 401, code: 'UNAUTHENTICATED');
    }

    public static function forbidden(string $message = 'This action is forbidden.', ?string $code = null): JsonResponse
    {
        return self::error($message, 403, code: $code ?? 'FORBIDDEN');
    }

    public static function notFound(string $message = 'Resource not found.'): JsonResponse
    {
        return self::error($message, 404, code: 'NOT_FOUND');
    }

    public static function validation(array $errors, string $message = 'The given data was invalid.'): JsonResponse
    {
        return self::error($message, 422, $errors, 'VALIDATION_ERROR');
    }

    private static function success(mixed $data, string $message, int $status, array $meta = []): JsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => $message,
            'data' => $data instanceof JsonResource ? $data->resolve() : $data,
            'errors' => (object) [],
            'meta' => (object) $meta,
        ], $status);
    }
}
