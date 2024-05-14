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

    bool operator == (const Vertex &other) const {
			return this->position == other.position;
		}
  };

  struct NormText {    
    glm::vec4 normal;
    glm::vec2 textCoord;
  };

  struct Triangle {
    alignas(16) glm::uvec3 vertexIndexes;
  };  
  
  struct Reference {
    uint32_t materialIndex;
    uint32_t transformIndex;
  };

  struct Material {
    alignas(16) glm::vec4 baseColor;
    alignas(16) glm::vec4 params;
    uint32_t colorTextureIndex;
  };

  struct Transformation {
    glm::mat4 modelMatrix{1.0f};
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
    float angle;
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
    alignas(4) bool isHit;
  };

  struct RayTraceUbo {
    alignas(16) glm::vec3 origin{0.0f};
    alignas(16) glm::vec3 horizontal{0.0f};
    alignas(16) glm::vec3 vertical{0.0f};
    alignas(16) glm::vec3 lowerLeftCorner{0.0f};
    alignas(16) glm::uvec2 imgSize{0u};
  };
}