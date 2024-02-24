#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugieApp {
  struct Vertex {
    alignas(16) glm::vec3 position;
    alignas(16) glm::vec2 textCoord;

    bool operator == (const Vertex &other) const {
			return this->position == other.position && this->textCoord == other.textCoord;
		}
  };

  struct Primitive {
    alignas(16) glm::uvec3 indices;
    uint32_t materialIndex;
  };

  struct Object {
    uint32_t firstBvhIndex;
    uint32_t firstPrimitiveIndex;
    uint32_t transformIndex;
  };

  struct BvhNode {
    uint32_t leftNode;
    uint32_t rightNode;
    uint32_t objIndex;
    alignas(16) glm::vec3 maximum;
    alignas(16) glm::vec3 minimum;
  };

  struct Material {
    alignas(16) glm::vec3 baseColor;
    alignas(16) glm::vec3 params;
    uint32_t colorTextureIndex;
  };

  struct Transformation {
    glm::mat4 pointMatrix;
    glm::mat4 dirMatrix;
    glm::mat4 pointInverseMatrix;
    glm::mat4 dirInverseMatrix;
    glm::mat4 normalMatrix;
  };

  struct PointLight {
    glm::vec4 position;
    glm::vec4 color;
  };

  struct SpotLight {
    alignas(16) glm::vec4 position;
    alignas(16) glm::vec4 color;
    alignas(16) glm::vec4 direction;
    float angle;
  };

  struct Ray {
    alignas(16) glm::vec3 origin;
    alignas(16) glm::vec3 direction;
  };

  struct HitRecord {
    bool isHit;

    uint32_t hitIndex;
    alignas(16) glm::vec3 point;
    alignas(16) glm::vec3 normal;
    alignas(16) glm::vec2 uv;
  };

  struct RayGenData {
    alignas(16) glm::vec3 origin;
    alignas(16) glm::vec3 horizontal;
    alignas(16) glm::vec3 vertical;
    alignas(16) glm::vec3 lowerLeftCorner;
    alignas(16) glm::uvec2 screenSize;
  };

  struct ScreenRayCoord {
    alignas(16) glm::uvec2 coord;
  };
  
}