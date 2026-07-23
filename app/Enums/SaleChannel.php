<?php

namespace App\Enums;

enum SaleChannel: string
{
    case WalkIn = 'walk_in';
    case Pos = 'pos';
    case Phone = 'phone';
    case WhatsApp = 'whatsapp';
    case Online = 'online';
}
