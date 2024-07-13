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

        bool operator==(const Vertex &other) const {
            return this->position == other.position;
        }
    };
    
    struct Material {
        glm::vec4 baseColor;
    };

    struct Transformation {
        glm::mat4 worldToObjectMatrix{1.0f};
        glm::mat4 objectToWorldMatrix{1.0f};
    };

    struct WorldToObjectTransformation {
        glm::mat4 worldToObjectMatrix{1.0f};
    };

    struct ObjectToWorldTransformation {
        glm::mat4 objectToWorldMatrix{1.0f};
    };
}