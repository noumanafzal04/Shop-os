<?php

namespace App\Enums;

/**
 * The common Item model supports both physical products and services —
 * a salon sells haircuts, a store sells shirts, one codebase serves both.
 */
enum ItemType: string
{
    case Product = 'product';
    case Service = 'service';
}
