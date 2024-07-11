import { getPaths } from "../utils";
import { hashElement } from 'folder-hash';
import * as util from 'util';

const setDeployFlags = (attributes:any):string[] => {

    const result = [];

    if(attributes.description) {
        result.push(`--description="${attributes.description}"`)
    }

    ['major', 'minor', 'patch', 'public'].forEach(flag => {
        if(attributes[flag]){ 
            result.push(`--${flag}`)
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

export const deployFlexPlugin = async (attributes: any) => {

    const execFile = util.promisify(require('child_process').execFile);

    try {

        const { absolutePath } = getPaths(attributes.cwd);

        const env = { 
            ...process.env,
            ...(attributes.env || {})
        };

        await execFile('npm', [
            'install --legacy-peer-deps',
        ], {
            cwd: absolutePath,
            shell: true,
            stdio: [process.stdin, process.stdout, process.stderr],
            env
        });


        await execFile('twilio', [
            'flex:plugins:deploy',
            `--changelog="${attributes.changelog || 'deployed by infra as code'}"`,
            `--bypass-validation`,
            ...setDeployFlags(attributes)
        ], {
            cwd: absolutePath,
            shell: true,
            stdio: [process.stdin, process.stdout, process.stderr],
            env
        });

        if(attributes.release) {

            const pluginPackageJson = 
                require(`${absolutePath}/package.json`);

            if(pluginPackageJson) {

                await execFile('twilio', [
                    'flex:plugins:release', 
                    `--enable-plugin=${pluginPackageJson.name}@latest`,
                    ...setReleaseFlags(attributes.release, pluginPackageJson)
                ], {
                    cwd: absolutePath,
                    shell: true,
                    stdio: [process.stdin, process.stdout, process.stderr],
                    env
                });

            }

        }

    } catch (err) {

        console.log(err);
        throw new Error('error');

    }

}

export const disableFlexPlugin = async (attributes: any) => {
    
    const execFile = util.promisify(require('child_process').execFile);

    try {
        
        const { absolutePath } = getPaths(attributes.cwd);

        const env = { 
            ...process.env,
            ...(attributes.env || {})
        };

        const pluginPackageJson = 
            require(`${absolutePath}/package.json`);

        if(pluginPackageJson) {

            await execFile('twilio', [
                'flex:plugins:release', 
                `--disable-plugin=${pluginPackageJson.name}`
            ], {
                cwd: absolutePath,
                shell: true,
                stdio: [process.stdin, process.stdout, process.stderr],
                env
            });


        }

    } catch (err) {

        console.log(err);
        throw new Error('error');

    }

}

export const getArrayOfHashes = async (cwd:string) => {
    const rawHashObj = await hashElement(cwd);

    return rawHashObj.children.reduce((pr: any[], cur) => [...pr, { name: cur.name, hash: cur.hash }], []);
}