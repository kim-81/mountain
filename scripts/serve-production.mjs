import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {serverConfig} from '../server/config.mjs';

export function productionEnvironment(input, nodeVersion = process.versions.node) {
  if (Number(nodeVersion.split('.')[0]) < 24) throw Error('Node.js 24 이상이 필요합니다.');
  const env = {...input, SANGIL_LISTEN_HOST: input.SANGIL_LISTEN_HOST || '0.0.0.0'};
  if (!env.SANGIL_PUBLIC_ORIGIN) throw Error('운영 HTTPS 주소 SANGIL_PUBLIC_ORIGIN을 설정하세요.');
  if (env.RAILWAY_PROJECT_ID) {
    if (!env.RAILWAY_VOLUME_MOUNT_PATH) throw Error('지속 저장 볼륨을 먼저 연결하세요. 일정·후기를 임시 디스크에 저장하지 않습니다.');
    env.SANGIL_DATA_DIR ||= env.RAILWAY_VOLUME_MOUNT_PATH;
    const relative = path.relative(path.resolve(env.RAILWAY_VOLUME_MOUNT_PATH), path.resolve(env.SANGIL_DATA_DIR));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('데이터 저장 경로가 지속 저장 볼륨 밖에 있습니다.');
  } else if (!env.SANGIL_DATA_DIR) throw Error('지속 저장 경로 SANGIL_DATA_DIR을 설정하세요.');
  serverConfig(env);
  return env;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Object.assign(process.env, productionEnvironment(process.env));
  await import('./serve-local.mjs');
}
