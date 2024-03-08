#version 460

layout(location = 0) in vec4 inPosition;
layout(location = 1) in vec2 inTextCoord;

layout(location = 0) out vec2 outTextCoord;

void main() {
	outTextCoord = inTextCoord;	
	gl_Position = inPosition;
}