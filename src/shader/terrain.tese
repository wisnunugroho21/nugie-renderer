#version 460

layout(quads, equal_spacing, ccw) in;

layout(location = 0) in vec2 teseTextCoord[];

layout(location = 0) out float fragHeight;

layout(set = 0, binding = 0) uniform readonly VertexData {
	mat4 cameraTransforms;
} ubo;

layout(set = 0, binding = 1) uniform sampler2D heightMapTexture;

void main() {
  float u = gl_TessCoord.x;
	float v = gl_TessCoord.y;

	vec2 t00 = teseTextCoord[0];
	vec2 t01 = teseTextCoord[1];
	vec2 t10 = teseTextCoord[2];
	vec2 t11 = teseTextCoord[3];

	vec2 t0 = (t01 - t00) * u + t00;
	vec2 t1 = (t11 - t10) * u + t10;
	vec2 texCoord = (t1 - t0) * v + t0;

	fragHeight = texture(heightMapTexture, texCoord).y;

	vec4 p00 = gl_in[0].gl_Position;
	vec4 p01 = gl_in[1].gl_Position;
	vec4 p10 = gl_in[2].gl_Position;
	vec4 p11 = gl_in[3].gl_Position;

	vec4 uVec = p01 - p00;
	vec4 vVec = p10 - p00;
	vec4 normal = normalize( vec4(cross(vVec.xyz, uVec.xyz), 0) );

	vec4 p0 = (p01 - p00) * u + p00;
  vec4 p1 = (p11 - p10) * u + p10;
  vec4 p = (p1 - p0) * v + p0;

	p += normal * fragHeight;

	gl_Position = ubo.cameraTransforms * p;
}
