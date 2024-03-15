mkdir -p build/shader

glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/shadow_map.vert -o build/shader/shadow_map.vert.spv
glslc src/shader/terrain.frag -o build/shader/terrain.frag.spv
glslc src/shader/terrain.vert -o build/shader/terrain.vert.spv
glslc src/shader/terrain.tesc -o build/shader/terrain.tesc.spv
glslc src/shader/terrain.tese -o build/shader/terrain.tese.spv
glslc src/shader/frustum_cull.comp -o build/shader/frustum_cull.comp.spv
glslc src/shader/reset_cull.comp -o build/shader/reset_cull.comp.spv