#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugieApp {
  struct Sphere {
    glm::vec4 centerRadius;

    bool operator == (const Sphere &other) const {
			return this->centerRadius == other.centerRadius;
		}
  };

  struct Vertex {
    alignas(16) glm::vec3 position;
    alignas(16) glm::vec3 normal;
    alignas(16) glm::vec2 textCoord;

    bool operator == (const Vertex &other) const {
			return this->position == other.position && this->normal == other.normal && this->textCoord == other.textCoord;
		}
  };

  struct NormText {    
    glm::vec4 normal;
    glm::vec2 textCoord;
  };

  struct Triangle {
    alignas(16) glm::uvec3 vertexIndexes;
    alignas(4) uint32_t materialIndex;
  };  
  
  struct Reference {
    uint32_t materialIndex;
    uint32_t transformIndex;
  };

  struct Object {
    alignas(4) uint32_t firstBvhIndex;
    alignas(4) uint32_t firstGeometryIndex;
    alignas(4) uint32_t transformIndex;
  };

  struct BvhNode {
    alignas(4) uint32_t leftNode = 0u;
    alignas(4) uint32_t rightNode = 0u;

    alignas(4) uint32_t objIndex = 0u;
    alignas(4) uint32_t typeIndex = 0u;

    alignas(16) glm::vec3 maximum{0.0f};
    alignas(16) glm::vec3 minimum{0.0f};
  };

  struct Material {
    alignas(16) glm::vec4 baseColor;
  };

  struct Transformation {
    glm::mat4 pointMatrix{1.0f};
    glm::mat4 dirMatrix{1.0f};
    glm::mat4 pointInverseMatrix{1.0f};
    glm::mat4 dirInverseMatrix{1.0f};
    glm::mat4 normalMatrix{1.0f};
  };

  struct PointLight {
    glm::vec4 position;
    glm::vec4 color;
  };

  struct SpotLight {
    alignas(16) glm::vec4 position;
    alignas(16) glm::vec4 color;
    alignas(16) glm::vec4 direction;
    alignas(4) float angle;
  };

  struct SunLight {
    alignas(16) glm::vec4 color;
    alignas(16) glm::vec4 direction;
  };

  struct Ray {
    alignas(16) glm::vec3 origin{0.0f};
    alignas(16) glm::vec3 direction{0.0f};
  };

  struct Hit {
    alignas(4) bool isHit = false;

    alignas(4) uint32_t hitIndex;
    alignas(4) uint32_t hitTypeIndex;
    
    alignas(4) float t;
    alignas(16) glm::vec2 uv;
  };

  struct IndirectResult {
    alignas(4) bool isHit = false;

    alignas(16) glm::vec4 radiance;
    alignas(4) float pdf;

    Ray nextRay;
  };

  struct LightResult {
    alignas(4) bool isIlluminate = false;
    alignas(16) glm::vec4 radiance;
  };

  struct IntegratorResult {
    alignas(16) glm::vec3 totalRadiance{ 1.0f };
    alignas(4) float pdf = 1.0f;
  };

  struct RayTraceUbo {
    alignas(16) glm::vec3 origin;
    alignas(16) glm::vec3 horizontal;
    alignas(16) glm::vec3 vertical;
    alignas(16) glm::vec3 lowerLeftCorner;
    alignas(16) glm::uvec2 imgSize;
    alignas(4) uint32_t randomSeed;
    alignas(4) uint32_t numLight;
  };
}