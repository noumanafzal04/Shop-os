<?php

namespace App\Enums;

enum OtpPurpose: string
{
    case Login = 'login';
    case PasswordReset = 'password_reset';
    case Verification = 'verification';
}
