#include "camera.hpp"

#include <cassert>
#include <limits>

namespace NugieApp {
  void Camera::setOrthographicProjection(float left, float right, float top, float bottom, float near, float far) {
    this->projectionMatrix = glm::ortho(left, right, bottom, top, near, far);
  }
    
  void Camera::setPerspectiveProjection(float fovy, float aspectRatio, float near, float far) {
    this->fovy = fovy;
    this->aspectRatio = aspectRatio;
    this->near = near;
    this->far = far;

    this->projectionMatrix = glm::perspective(fovy, aspectRatio, near, far);
  }

  void Camera::setAspect(float aspectRatio) {
    this->aspectRatio = aspectRatio;
    this->projectionMatrix = glm::perspective(this->fovy, aspectRatio, this->near, this->far);
  }

  void Camera::setViewDirection(glm::vec3 position, glm::vec3 direction, glm::vec3 up) {
    this->position = position;
    this->direction = direction;

    this->viewMatrix = glm::lookAt(position, position + direction, up);
  }

  void Camera::setViewTarget(glm::vec3 position, glm::vec3 target, glm::vec3 up) {
    this->position = position;
    this->direction = target - position;

    this->viewMatrix = glm::lookAt(position, target, up);
  }
} // namespace nugiEngine
