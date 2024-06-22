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
        alignas(16) glm::vec3 normal;

        bool operator==(const Vertex &other) const {
            return this->position == other.position && this->normal == other.normal;
        }
    };

    struct Triangle {
        glm::uvec4 vertexMaterialIndexes;
    };

    struct Object {
        uint32_t firstBvhIndex;
        uint32_t firstGeometryIndex;
        uint32_t transformIndex;
        uint32_t dummyIndex;
    };

    struct BvhNode {
        uint32_t leftNode = 0u;
        uint32_t rightNode = 0u;
        uint32_t objIndex = 0u;
        uint32_t typeIndex = 0u;

        alignas(16) glm::vec3 maximum{0.0f};
        alignas(16) glm::vec3 minimum{0.0f};
    };

    struct Material {
        glm::vec4 baseColor;
    };

    struct Transformation {
        glm::mat4 worldToObjectMatrix{1.0f};
        glm::mat4 objectToWorldMatrix{1.0f};
    };

    struct Ray {
        glm::vec4 origin{0.0f};
        glm::vec4 direction{0.0f};
    };

    struct Hit {
        float t = 0.0f;
        alignas(16) glm::vec2 uv{0.0f};

        uint32_t hitGeometryIndex = 0u;
        uint32_t hitGeometryTypeIndex = 0u;
        uint32_t hitTransformIndex = 0u;
    };

    struct DirectData {
        glm::vec4 normalIsIlluminate{0.0f};
        glm::vec4 originMaterialIndex{0.0f};
    };

    struct DirectResult {
        glm::vec4 radiancePdf{0.0f};
    };

    struct IndirectResult {
        glm::vec4 radiancePdf{0.0f};
        Ray nextRay{};
    };

    struct LightResult {
        glm::vec4 radianceIsIlluminate{0.0f};
    };

    struct MissResult {
        glm::vec4 radianceIsMiss{0.0f};
    };

    struct IntegratorResult {
        glm::vec4 totalRadianceIsRayBounce{0.0f};
        glm::vec4 totalIndirectPdf{1.0f};
    };

    struct SamplingResult {
        glm::vec4 finalColorCountSample{0.0f};
    };

    struct RayTraceUbo {
        alignas(16) glm::vec3 origin{0.0f};
        alignas(16) glm::vec3 horizontal{0.0f};
        alignas(16) glm::vec3 vertical{0.0f};
        alignas(16) glm::vec3 lowerLeftCorner{0.0f};
        alignas(16) glm::uvec4 imgSizeRandomSeedNumLight{0u};
    };
}