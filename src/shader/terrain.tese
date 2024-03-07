#version 460

layout(quads, equal_spacing, ccw) in;

layout(location = 0) in vec2 inTextCoord[];

layout(location = 0) out float outHeight;

layout(set = 0, binding = 0) uniform readonly VertexData {
	mat4 cameraTransforms;
} ubo;

layout(set = 0, binding = 1) uniform sampler2D heightMapTexture;

void main() {
	vec2 uv1 = mix(inTextCoord[0], inTextCoord[1], gl_TessCoord.x);
	vec2 uv2 = mix(inTextCoord[3], inTextCoord[2], gl_TessCoord.x);
	vec2 uv = mix(uv1, uv2, gl_TessCoord.y);

	vec4 pos1 = mix(gl_in[0].gl_Position, gl_in[1].gl_Position, gl_TessCoord.x);
	vec4 pos2 = mix(gl_in[3].gl_Position, gl_in[2].gl_Position, gl_TessCoord.x);
	vec4 pos = mix(pos1, pos2, gl_TessCoord.y);

	outHeight = pos.y;
	pos.y = (texture(heightMapTexture, uv).r * -1.0f);
	
	gl_Position = ubo.cameraTransforms * pos;
}
