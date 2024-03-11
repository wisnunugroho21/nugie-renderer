#version 460

layout(quads, equal_spacing, ccw) in;

layout(location = 0) in vec2 inTextCoord[];

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec2 outTextCoord;

layout(set = 0, binding = 2) uniform readonly CameraTransformationBuffer {
	mat4 view;
	mat4 projection;
};

layout(set = 0, binding = 3) uniform sampler2D heightMapTexture;

void main() {
	vec2 uv1 = mix(inTextCoord[0], inTextCoord[1], gl_TessCoord.x);
	vec2 uv2 = mix(inTextCoord[3], inTextCoord[2], gl_TessCoord.x);
	vec2 heightTextCoord = mix(uv1, uv2, gl_TessCoord.y);

	vec4 pos1 = mix(gl_in[0].gl_Position, gl_in[1].gl_Position, gl_TessCoord.x);
	vec4 pos2 = mix(gl_in[3].gl_Position, gl_in[2].gl_Position, gl_TessCoord.x);
	vec4 pos = mix(pos1, pos2, gl_TessCoord.y);
	
	pos.y = texture(heightMapTexture, heightTextCoord).r;

	outPosition = pos;
	outTextCoord = vec2(gl_TessCoord);

	// pos.y = pos.y * -1.0f;	
	gl_Position = projection * view * pos;
}
