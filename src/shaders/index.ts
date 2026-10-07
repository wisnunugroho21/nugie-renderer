import type { ShaderManager } from '../gpu/ShaderManager';
import commonSrc from './common.wgsl?raw';
import commonTypes from './common_types.wgsl?raw';
import commonBindFrame from './common_bind_frame.wgsl?raw';
import commonBindScene from './common_bind_scene.wgsl?raw';
import commonBindMaterial from './common_bind_material.wgsl?raw';
import commonBindObject from './common_bind_object.wgsl?raw';
import commonFuncs from './common_funcs.wgsl?raw';
import commonColor from './common_color.wgsl?raw';
import particlesCommon from './particles_common.wgsl?raw';
import ribbonsCommon from './ribbons_common.wgsl?raw';
import brdfSrc from './brdf.wgsl?raw';
import lightingSrc from './lighting.wgsl?raw';
import iblCommon from './ibl_common.wgsl?raw';
import iblEval from './ibl_eval.wgsl?raw';
import sceneEval from './scene_eval.wgsl?raw';
import pbrSrc from './pbr.wgsl?raw';
import errorSrc from './error.wgsl?raw';

export const PBR_SOURCE = pbrSrc;
export const ERROR_SOURCE = errorSrc;
export const COMMON_PRELUDE = '//#include common\n//#include lighting\n//#include ibl_eval\n';

/**
 * Register shared WGSL chunks (`//#include name`). `common` = types + all four bind groups + shared functions;
 * the pieces are also registered separately so tools/tests can include only what they need.
 */
export function registerEngineShaderChunks(shaders: ShaderManager): void {
  shaders.registerChunk('common', commonSrc);
  shaders.registerChunk('common_types', commonTypes);
  shaders.registerChunk('common_bind_frame', commonBindFrame);
  shaders.registerChunk('common_bind_scene', commonBindScene);
  shaders.registerChunk('common_bind_material', commonBindMaterial);
  shaders.registerChunk('common_bind_object', commonBindObject);
  shaders.registerChunk('common_color', commonColor);
  shaders.registerChunk('common_funcs', commonFuncs);
  shaders.registerChunk('particles_common', particlesCommon);
  shaders.registerChunk('ribbons_common', ribbonsCommon);
  shaders.registerChunk('brdf', brdfSrc);
  shaders.registerChunk('lighting', lightingSrc);
  shaders.registerChunk('ibl_common', iblCommon);
  shaders.registerChunk('ibl_eval', iblEval);
  shaders.registerChunk('scene_eval', sceneEval);
}
