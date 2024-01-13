#pragma once

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/matrix_inverse.hpp>

#include <memory>
#include "../../general_struct.hpp"

namespace NugieApp {
	struct TransformComponent {
		glm::vec3 translation{0.0f};
		glm::vec3 scale{1.0f};
		glm::vec3 rotation{0.0f};

		glm::vec3 objectMinimum{0.0f};
		glm::vec3 objectMaximum{0.0f};
		
		glm::mat4 getModelMatrix() const;
    glm::mat3 getNormalMatrix() const;
		glm::mat4 getPointMatrix() const;
    glm::mat4 getPointInverseMatrix() const;
    glm::mat4 getDirInverseMatrix() const;
	};

	std::vector<Transformation> ConvertComponentToTransform(const std::vector<TransformComponent> &transformations);
}