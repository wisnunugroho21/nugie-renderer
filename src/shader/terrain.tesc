#version 460

layout(vertices = 4) out;

layout(location = 0) in vec2 tescTextCoord[];

layout(location = 0) out vec2 teseTextCoord[];

void main() {
  gl_out[gl_InvocationID].gl_Position = gl_in[gl_InvocationID].gl_Position;
  teseTextCoord[gl_InvocationID] = tescTextCoord[gl_InvocationID];

  if (gl_InvocationID == 0) {
    gl_TessLevelOuter[0] = 2;
    gl_TessLevelOuter[1] = 2;
    gl_TessLevelOuter[2] = 2;
    gl_TessLevelOuter[3] = 2;
    
    gl_TessLevelInner[0] = 1;
    gl_TessLevelInner[1] = 1;
  }
}