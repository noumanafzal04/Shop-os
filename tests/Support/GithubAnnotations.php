<?php

namespace Tests\Support;

use PHPUnit\Event\Code\Test;
use PHPUnit\Event\Code\TestMethod;
use PHPUnit\Event\Test\Errored;
use PHPUnit\Event\Test\ErroredSubscriber;
use PHPUnit\Event\Test\Failed;
use PHPUnit\Event\Test\FailedSubscriber;
use PHPUnit\Runner\Extension\Extension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

/**
 * A RED TEST NAMES ITSELF ON GITHUB.
 *
 * The MySQL job went red on every push for six weeks saying only "Process
 * completed with exit code 1": a job's log needs admin rights to read, and
 * the step that would have turned failures into annotations could not be
 * changed without a token allowed to edit workflows. An annotation is any
 * line on the job's output that starts `::error` — so the suite says it
 * itself, one line per failing or erroring test, readable by anybody through
 * the public API (check-runs/{job}/annotations).
 *
 * Only under GitHub Actions; a run anywhere else prints nothing extra.
 */
final class GithubAnnotations implements Extension
{
    public function bootstrap(Configuration $configuration, Facade $facade, ParameterCollection $parameters): void
    {
        if (getenv('GITHUB_ACTIONS') !== 'true') {
            return;
        }

        $facade->registerSubscribers(
            new class implements FailedSubscriber
            {
                public function notify(Failed $event): void
                {
                    GithubAnnotations::say('failed', $event->test(), $event->throwable()->message());
                }
            },
            new class implements ErroredSubscriber
            {
                public function notify(Errored $event): void
                {
                    GithubAnnotations::say('error', $event->test(), $event->throwable()->className().': '.$event->throwable()->message());
                }
            },
        );
    }

    public static function say(string $kind, Test $test, string $message): void
    {
        $where = '';
        if ($test instanceof TestMethod) {
            $file = str_replace(getcwd().'/', '', $test->file());
            $where = ' file='.self::property($file).',line='.$test->line().',';
        }
        $engine = getenv('DB_CONNECTION') ?: 'sqlite';
        $title = self::property("{$engine} {$kind}: ".$test->id());

        // On a line of its own: the runner reads `::error` only at a line start.
        fwrite(STDOUT, "\n::error".($where === '' ? ' ' : $where)."title={$title}::".self::data(mb_substr($message, 0, 900))."\n");
    }

    /** Workflow-command escaping for the message. */
    private static function data(string $s): string
    {
        return str_replace(['%', "\r", "\n"], ['%25', '%0D', '%0A'], $s);
    }

    /** …and for a property, which also may not hold `:` or `,`. */
    private static function property(string $s): string
    {
        return str_replace([':', ','], ['%3A', '%2C'], self::data($s));
    }
}
