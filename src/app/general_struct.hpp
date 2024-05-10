#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugieApp {
  struct Vertex {
		glm::vec3 position{};

		bool operator == (const Vertex &other) const {
			return this->position == other.position;
		}
	};

  struct RayTraceVertex {
    alignas(16) glm::vec3 position{0.0f};
    alignas(16) glm::vec2 textCoord{0.0f};

    bool operator == (const RayTraceVertex &other) const {
			return this->position == other.position && this->textCoord == other.textCoord;
		}
  };

  struct Primitive {
    alignas(16) glm::uvec3 indices{0u};
    uint32_t materialIndex = 0u;
  };

  struct Object {
    uint32_t firstBvhIndex = 0u;
    uint32_t firstPrimitiveIndex = 0u;
    uint32_t transformIndex = 0u;
  };

  struct TriangleLight {
    alignas(16) glm::uvec3 indices{0u};
    alignas(16) glm::vec3 color{0.0f};
  };

  struct PointLight {
    alignas(16) glm::vec3 position{0.0f};
    alignas(16) glm::vec3 color{0.0f};
  };

  struct SunLight {
    alignas(16) glm::vec3 direction{0.0f};
    alignas(16) glm::vec3 color{0.0f};
  };

  struct BvhNode {
    uint32_t leftNode = 0u;
    uint32_t rightNode = 0u;
    uint32_t objIndex = 0u;

    alignas(16) glm::vec3 maximum{0.0f};
    alignas(16) glm::vec3 minimum{0.0f};
  };

  struct Material {
    alignas(16) glm::vec3 baseColor{0.0f};
    float metallicness = 0.0f;
    float roughness = 0.0f;
    float fresnelReflect = 0.0f;

    uint32_t colorTextureIndex = 0u;
    uint32_t normalTextureIndex = 0u;
  };

  struct Transformation {
    glm::mat4 pointMatrix{1.0f};
    glm::mat4 dirMatrix{1.0f};
    glm::mat4 pointInverseMatrix{1.0f};
    glm::mat4 dirInverseMatrix{1.0f};
    glm::mat4 normalMatrix{1.0f};
  };

  struct Ray {
    alignas(16) glm::vec3 origin{0.0f};
    alignas(16) glm::vec3 direction{0.0f};
  };

  struct RayData {
    Ray ray{};

    float dirMin = 0.001f;
    alignas(16) glm::vec3 dirMax{1000000.0f};

    uint32_t rayBounce = 0u;
  };

  struct HitRecord {
    bool isHit = false;
    uint32_t rayBounce = 0u;

    uint32_t hitIndex = 0u;
    uint32_t materialIndex = 0u;

    alignas(16) glm::vec3 point{0.0f};
    alignas(16) glm::vec3 dir{0.0f};
    alignas(16) glm::vec3 normal{0.0f};
    alignas(16) glm::vec2 uv{0.0f};
  };

  struct IndirectShadeRecord {
    bool isIlluminate = false;
    alignas(16) glm::vec3 radiance{0.0f};
    float pdf = 0.0f;

    Ray nextRay{};
  };

  struct DirectShadeRecord {
    bool isIlluminate = false;
    alignas(16) glm::vec3 radiance{0.0f};
    float pdf = 0.0f;
  };

  struct LightShadeRecord {
    bool isIlluminate = false;
    alignas(16) glm::vec3 radiance{0.0f};
    uint32_t rayBounce = 0u;
  };

  struct MissRecord {
    bool isMiss = false;
    alignas(16) glm::vec3 radiance{0.0f};
  };

  struct IndirectSamplerData {
    uint32_t xCoord = 0u;
    uint32_t yCoord = 0u;
    uint32_t rayBounce = 0u;

    Ray nextRay{};
  };

  struct DirectData {
    bool isIlluminate = false;
    uint32_t materialIndex = 0u;
    alignas(16) glm::vec3 normal{0.0f};
    alignas(16) glm::vec2 uv{0.0f};
  };

  struct RenderResult {
    alignas(16) glm::vec3 totalIndirect{1.0f};
    alignas(16) glm::vec3 totalRadiance{0.0f};
    float pdf = 0.0f;
  };

  struct RayTraceUbo {
    alignas(16) glm::vec3 origin{0.0f};
    alignas(16) glm::vec3 horizontal{0.0f};
    alignas(16) glm::vec3 vertical{0.0f};
    alignas(16) glm::vec3 lowerLeftCorner{0.0f};
    alignas(16) glm::uvec2 imgSize{0u};
    SunLight sunLight;
    alignas(16) glm::vec3 skyColor{0.0f};
    alignas(16) glm::uvec2 numLightsRandomSeed{0u};
  };

  struct RayTracePushConstant {
    uint32_t randomSeed = 0u;
  };
}