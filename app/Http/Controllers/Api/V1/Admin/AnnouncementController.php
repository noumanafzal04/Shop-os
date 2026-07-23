<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Announcements\SendAnnouncement;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\AnnouncementRequest;
use App\Models\Announcement;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

class AnnouncementController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok(Announcement::query()->latest()->get());
    }

    public function store(AnnouncementRequest $request): JsonResponse
    {
        $data = $request->validated();
        if ($request->hasFile('image')) {
            $data['image_path'] = $request->file('image')->store('announcements', 'public');
        }
        unset($data['image']);

        $announcement = Announcement::query()->create($data);

        return ApiResponse::created($announcement->refresh(), 'Announcement saved');
    }

    public function update(AnnouncementRequest $request, string $id): JsonResponse
    {
        /** @var Announcement $announcement */
        $announcement = Announcement::query()->findOrFail($id);
        $data = $request->validated();

        if ($request->hasFile('image')) {
            if ($announcement->image_path) {
                Storage::disk('public')->delete($announcement->image_path);
            }
            $data['image_path'] = $request->file('image')->store('announcements', 'public');
        }
        unset($data['image']);

        $announcement->update($data);

        return ApiResponse::ok($announcement, 'Announcement updated');
    }

    public function send(string $id, SendAnnouncement $action): JsonResponse
    {
        /** @var Announcement $announcement */
        $announcement = Announcement::query()->findOrFail($id);
        $announcement = $action->execute($announcement);

        return ApiResponse::ok($announcement, "Sent to {$announcement->recipients_count} recipient(s)");
    }

    public function destroy(string $id): JsonResponse
    {
        /** @var Announcement $announcement */
        $announcement = Announcement::query()->findOrFail($id);
        if ($announcement->image_path) {
            Storage::disk('public')->delete($announcement->image_path);
        }
        $announcement->delete();

        return ApiResponse::noContent('Announcement deleted');
    }
}
