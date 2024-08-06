#include "camera.hpp"

#include <cassert>
#include <limits>

namespace NugieApp {
    Camera::Camera() {}

    void Camera::setAspect(float aspectRatio) {
		this->aspectRatio = aspectRatio;

		assert(glm::abs(aspectRatio - std::numeric_limits<float>::epsilon()) > 0.0f);
		const float tanHalfFovy = tan(this->fovy / 2.0f);
		this->projectionMatrix = glm::mat4{0.0f};
		this->projectionMatrix[0][0] = 1.f / (this->aspectRatio * tanHalfFovy);
		this->projectionMatrix[1][1] = 1.f / (tanHalfFovy);
		this->projectionMatrix[2][2] = this->far / (this->far - this->near);
		this->projectionMatrix[2][3] = 1.f;
		this->projectionMatrix[3][2] = -(this->far * this->near) / (this->far - this->near);
	}

    void Camera::setOrthographicProjection(float left, float right, float top, float bottom, float near, float far) {
        this->projectionMatrix = glm::mat4{1.0f};
		this->projectionMatrix[0][0] = 2.0f / (right - left);
		this->projectionMatrix[1][1] = 2.0f / (bottom - top);
		this->projectionMatrix[2][2] = 1.0f / (far - near);
		this->projectionMatrix[3][0] = -(right + left) / (right - left);
		this->projectionMatrix[3][1] = -(bottom + top) / (bottom - top);
		this->projectionMatrix[3][2] = -near / (far - near);
    }

    void Camera::setPerspectiveProjection(float fovy, float aspectRatio, float near, float far) {
        this->fovy = fovy;
		this->aspectRatio = aspectRatio;
		this->near = near;
		this->far = far;

		assert(glm::abs(aspectRatio - std::numeric_limits<float>::epsilon()) > 0.0f);
		const float tanHalfFovy = tan(fovy / 2.0f);
		this->projectionMatrix = glm::mat4{0.0f};
		this->projectionMatrix[0][0] = 1.f / (aspectRatio * tanHalfFovy);
		this->projectionMatrix[1][1] = 1.f / (tanHalfFovy);
		this->projectionMatrix[2][2] = far / (far - near);
		this->projectionMatrix[2][3] = 1.f;
		this->projectionMatrix[3][2] = -(far * near) / (far - near);
    }

    void Camera::setViewDirection(glm::vec3 position, glm::vec3 direction, glm::vec3 vup) {
        this->position = position;
		this->direction = glm::normalize(direction);

		this->rotation.x = glm::acos(this->direction.z);
		this->rotation.y = glm::atan(this->direction.y / this->direction.x);

		const glm::vec3 w{this->direction};
		const glm::vec3 u{glm::normalize(glm::cross(w, vup))};
		const glm::vec3 v{glm::cross(w, u)};

		this->viewMatrix = glm::mat4{1.0f};
		this->viewMatrix[0][0] = u.x;
		this->viewMatrix[1][0] = u.y;
		this->viewMatrix[2][0] = u.z;
		this->viewMatrix[0][1] = v.x;
		this->viewMatrix[1][1] = v.y;
		this->viewMatrix[2][1] = v.z;
		this->viewMatrix[0][2] = w.x;
		this->viewMatrix[1][2] = w.y;
		this->viewMatrix[2][2] = w.z;
		this->viewMatrix[3][0] = -glm::dot(u, this->position);
		this->viewMatrix[3][1] = -glm::dot(v, this->position);
		this->viewMatrix[3][2] = -glm::dot(w, this->position);

		this->inverseViewMatrix = glm::mat4{1.0f};
		this->inverseViewMatrix[0][0] = u.x;
		this->inverseViewMatrix[0][1] = u.y;
		this->inverseViewMatrix[0][2] = u.z;
		this->inverseViewMatrix[1][0] = v.x;
		this->inverseViewMatrix[1][1] = v.y;
		this->inverseViewMatrix[1][2] = v.z;
		this->inverseViewMatrix[2][0] = w.x;
		this->inverseViewMatrix[2][1] = w.y;
		this->inverseViewMatrix[2][2] = w.z;
		this->inverseViewMatrix[3][0] = this->position.x;
		this->inverseViewMatrix[3][1] = this->position.y;
		this->inverseViewMatrix[3][2] = this->position.z;
    }

    void Camera::setViewTarget(glm::vec3 position, glm::vec3 target, glm::vec3 vup) {
        this->setViewDirection(position, target - position, vup);
    }

	void Camera::setViewYXZ(glm::vec3 position, glm::vec2 rotation, glm::vec3 up) {
		this->position = position;
		this->rotation = rotation;

		// this->direction.x = cos(glm::radians(this->rotation.x)) * cos(glm::radians(this->rotation.y));
		// this->direction.y = sin(glm::radians(this->rotation.y));
		// this->direction.z = sin(glm::radians(this->rotation.x)) * cos(glm::radians(this->rotation.y));

		const glm::vec3 w{glm::normalize(this->direction)};
		const glm::vec3 u{glm::normalize(glm::cross(w, up))};
		const glm::vec3 v{glm::cross(w, u)};

		this->viewMatrix = glm::mat4{1.0f};
		this->viewMatrix[0][0] = u.x;
		this->viewMatrix[1][0] = u.y;
		this->viewMatrix[2][0] = u.z;
		this->viewMatrix[0][1] = v.x;
		this->viewMatrix[1][1] = v.y;
		this->viewMatrix[2][1] = v.z;
		this->viewMatrix[0][2] = w.x;
		this->viewMatrix[1][2] = w.y;
		this->viewMatrix[2][2] = w.z;
		this->viewMatrix[3][0] = -glm::dot(u, this->position);
		this->viewMatrix[3][1] = -glm::dot(v, this->position);
		this->viewMatrix[3][2] = -glm::dot(w, this->position);

		this->inverseViewMatrix = glm::mat4{1.0f};
		this->inverseViewMatrix[0][0] = u.x;
		this->inverseViewMatrix[0][1] = u.y;
		this->inverseViewMatrix[0][2] = u.z;
		this->inverseViewMatrix[1][0] = v.x;
		this->inverseViewMatrix[1][1] = v.y;
		this->inverseViewMatrix[1][2] = v.z;
		this->inverseViewMatrix[2][0] = w.x;
		this->inverseViewMatrix[2][1] = w.y;
		this->inverseViewMatrix[2][2] = w.z;
		this->inverseViewMatrix[3][0] = this->position.x;
		this->inverseViewMatrix[3][1] = this->position.y;
		this->inverseViewMatrix[3][2] = this->position.z;
	}
} // namespace nugiEngine
