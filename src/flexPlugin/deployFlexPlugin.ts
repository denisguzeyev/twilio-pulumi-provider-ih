import { getPaths } from "../utils";
import { execFileStreaming } from "../utils/execFile";
import { hashElement } from 'folder-hash';

const setDeployFlags = (attributes:any):string[] => {

    const result = [];

    if(attributes.description) {
        result.push(`--description="${attributes.description}"`)
    }

    ['major', 'minor', 'patch', 'public'].forEach(flag => {
        if(attributes[flag]){ 
            result.push(`--${flag}`)
        }
    });

    return result;

}

const setReleaseFlags = (attributes:any, packageJson:any):string[] => {

    const result = [];

    if(attributes.name) {
        result.push(`--name="${attributes.name}"`)
    }

    if(attributes.description) {
        result.push(`--description="${attributes.description}"`)
    }

    if(attributes.disablePlugin) {
        result.push(`--disable-plugin=${packageJson.name}`)
    }

    return result;
}

const toError = (err: unknown, context: string): Error => {

    const message = err instanceof Error ? err.message : String(err);

    return new Error(`${context}: ${message}`);

}

/**
 * `twilio flex:plugins:deploy` asks "Plugin package has already been uploaded
 * previously for this version of the plugin. Would you like to overwrite it?"
 * whenever a previous deployment uploaded the assets without registering the
 * version. The CLI only skips that prompt when `CI` is exactly "true"
 * (`env.isCI()` in flex-plugins-utils-env), otherwise it blocks on stdin.
 */
const buildEnv = (attributes: any): NodeJS.ProcessEnv => ({
    CI: 'true',
    ...process.env,
    ...(attributes.env || {})
});

export const deployFlexPlugin = async (attributes: any) => {

    try {

        const { absolutePath } = getPaths(attributes.cwd);

        const env = buildEnv(attributes);

        await execFileStreaming('npm', [
            'install --legacy-peer-deps --allow-remote=all',
        ], {
            cwd: absolutePath,
            shell: true,
            env
        });


        await execFileStreaming('twilio', [
            'flex:plugins:deploy',
            `--changelog="${attributes.changelog || 'deployed by infra as code'}"`,
            `--bypass-validation`,
            ...setDeployFlags(attributes)
        ], {
            cwd: absolutePath,
            shell: true,
            env
        });

        if(attributes.release) {

            const pluginPackageJson = 
                require(`${absolutePath}/package.json`);

            if(pluginPackageJson) {

                await execFileStreaming('twilio', [
                    'flex:plugins:release', 
                    `--enable-plugin=${pluginPackageJson.name}@latest`,
                    ...setReleaseFlags(attributes.release, pluginPackageJson)
                ], {
                    cwd: absolutePath,
                    shell: true,
                    env
                });

            }

        }

    } catch (err) {

        throw toError(err, `Failed to deploy flex plugin "${attributes.cwd}"`);

    }

}

export const disableFlexPlugin = async (attributes: any) => {

    try {
        
        const { absolutePath } = getPaths(attributes.cwd);

        const env = buildEnv(attributes);

        const pluginPackageJson = 
            require(`${absolutePath}/package.json`);

        if(pluginPackageJson) {

            await execFileStreaming('twilio', [
                'flex:plugins:release', 
                `--disable-plugin=${pluginPackageJson.name}`
            ], {
                cwd: absolutePath,
                shell: true,
                env
            });


        }

    } catch (err) {

        throw toError(err, `Failed to disable flex plugin "${attributes.cwd}"`);

    }

}

export const getArrayOfHashes = async (cwd:string) => {
    const rawHashObj = await hashElement(cwd);

    return rawHashObj.children.reduce((pr: any[], cur) => [...pr, { name: cur.name, hash: cur.hash }], []);
}
