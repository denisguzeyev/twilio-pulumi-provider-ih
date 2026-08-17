import { spawn } from 'child_process';
import * as path from 'path';

/**
 * `child_process.execFile` ignores the `stdio` option: it always pipes the output
 * of the child process into memory and aborts as soon as `maxBuffer` (1 MiB by
 * default) is exceeded. Building a Flex plugin (`npm install` +
 * `twilio flex:plugins:deploy`) easily produces more output than that, and when
 * Node kills the intermediate shell the still running `npm`/`twilio`
 * grandchildren keep the stdout pipe open. The `close` event never fires, so the
 * pulumi dynamic provider process never finishes and `pulumi up` hangs forever.
 *
 * `execFileStreaming` uses `spawn` instead:
 *  - the output is streamed to the parent's stdout/stderr (prefixed with the
 *    working directory) instead of being buffered, so there is no size limit and
 *    the build progress is visible in CI logs,
 *  - stdin is closed, so an interactive CLI prompt fails fast instead of blocking
 *    the run forever,
 *  - a timeout terminates the whole process group, so a run can never hang
 *    indefinitely.
 */

export interface ExecFileStreamingOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    timeout?: number;
    killSignal?: NodeJS.Signals;
}

export interface ExecFileStreamingResult {
    stdout: string;
    stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const KILL_GRACE_MS = 10 * 1000;
const TAIL_LIMIT = 64 * 1024;

const getTimeoutMs = (options: ExecFileStreamingOptions): number => {
    if (options.timeout) {
        return options.timeout;
    }

    const configured = process.env.TWILIO_PULUMI_EXEC_TIMEOUT_MS;

    if (configured === undefined) {
        return DEFAULT_TIMEOUT_MS;
    }

    const parsed = Number.parseInt(configured, 10);

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TIMEOUT_MS;
};

export const execFileStreaming = (
    file: string,
    args: string[] = [],
    options: ExecFileStreamingOptions = {}
): Promise<ExecFileStreamingResult> => new Promise((resolve, reject) => {

    const command = [file, ...args].join(' ');
    const prefix = `[${options.cwd ? path.basename(options.cwd) : file}] `;

    // a dedicated process group allows killing npm/webpack children on timeout
    const detached = process.platform !== 'win32';

    const child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        shell: options.shell,
        detached,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    process.stdout.write(`${prefix}$ ${command}\n`);

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const pipe = (
        source: NodeJS.ReadableStream,
        target: NodeJS.WritableStream,
        append: (chunk: string) => void
    ) => {

        let pending = '';

        source.setEncoding('utf8');

        source.on('data', (chunk: string) => {
            append(chunk);
            pending += chunk;
            const lines = pending.split('\n');
            pending = lines.pop() as string;
            lines.forEach(line => target.write(`${prefix}${line}\n`));
        });

        source.on('end', () => {
            if (pending) {
                target.write(`${prefix}${pending}\n`);
            }
        });

    };

    pipe(child.stdout, process.stdout, chunk => {
        stdout = (stdout + chunk).slice(-TAIL_LIMIT);
    });

    pipe(child.stderr, process.stderr, chunk => {
        stderr = (stderr + chunk).slice(-TAIL_LIMIT);
    });

    const killTree = (signal: NodeJS.Signals) => {
        try {
            if (detached && child.pid) {
                process.kill(-child.pid, signal);
            } else {
                child.kill(signal);
            }
        } catch (err) {
            // the process is already gone
        }
    };

    const timeoutMs = getTimeoutMs(options);

    const timer = timeoutMs ? setTimeout(() => {
        timedOut = true;
        process.stderr.write(`${prefix}timeout after ${timeoutMs}ms, killing: ${command}\n`);
        killTree(options.killSignal || 'SIGTERM');
        setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS).unref();
    }, timeoutMs) : undefined;

    const settle = (error?: Error) => {

        if (settled) {
            return;
        }

        settled = true;

        if (timer) {
            clearTimeout(timer);
        }

        if (error) {
            reject(error);
        } else {
            resolve({ stdout, stderr });
        }

    };

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {

        if (code === 0 && !timedOut) {
            settle();
            return;
        }

        const reason = timedOut
            ? `timed out after ${timeoutMs}ms`
            : `failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`;

        settle(new Error(`Command ${reason}: ${command}\n${stderr}`));

    };

    child.on('error', err => settle(err));

    // `close` waits for the stdio pipes, which may still be held by lingering
    // grandchildren (npm/webpack workers). `exit` plus a grace period makes sure
    // the promise settles even then.
    child.on('exit', (code, signal) => {
        setTimeout(() => finish(code, signal), KILL_GRACE_MS).unref();
    });

    child.on('close', (code, signal) => finish(code, signal));

});
