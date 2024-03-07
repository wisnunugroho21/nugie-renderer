#version 460

layout(location = 0) in vec4 position;
layout(location = 1) in vec2 textCoord;

layout(location = 0) out vec2 tescTextCoord;

void main() {
	tescTextCoord = textCoord;	
	gl_Position = position;
}