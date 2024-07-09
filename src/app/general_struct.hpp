#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE

#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugieApp {
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