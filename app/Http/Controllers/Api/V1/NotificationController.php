<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\AppNotification;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    /**
     * Own notifications, newest first, with unread_count in meta.
     */
    public function index(Request $request): JsonResponse
    {
        $query = AppNotification::query()->where('user_id', $request->user()->id);

        $unread = (clone $query)->whereNull('read_at')->count();

        $notifications = $query
            ->when($request->boolean('unread_only'), fn ($q) => $q->whereNull('read_at'))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 50));

        $response = ApiResponse::paginated($notifications);
        $payload = $response->getData(true);
        $payload['meta']['unread_count'] = $unread;

        return response()->json($payload);
    }

    public function markRead(Request $request, string $id): JsonResponse
    {
        $notification = AppNotification::query()
            ->where('user_id', $request->user()->id)
            ->findOrFail($id);

        $notification->forceFill(['read_at' => $notification->read_at ?? now()])->save();

        return ApiResponse::ok($notification, 'Marked as read');
    }

    public function markAllRead(Request $request): JsonResponse
    {
        AppNotification::query()
            ->where('user_id', $request->user()->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return ApiResponse::ok(null, 'All notifications marked as read');
    }
}
