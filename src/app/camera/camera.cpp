#include "camera.hpp"

#include <cassert>
#include <limits>

namespace NugieApp {
  void Camera::setOrthographicProjection(float left, float right, float top, float bottom, float near, float far) {
    this->projectionMatrix = glm::mat4{1.0f};
    this->projectionMatrix[0][0] = 2.f / (right - left);
    this->projectionMatrix[1][1] = 2.f / (bottom - top);
    this->projectionMatrix[2][2] = 1.f / (far - near);
    this->projectionMatrix[3][0] = -(right + left) / (right - left);
    this->projectionMatrix[3][1] = -(bottom + top) / (bottom - top);
    this->projectionMatrix[3][2] = -near / (far - near);
  }
    
  void Camera::setPerspectiveProjection(float fovy, float aspect, float near, float far) {
    assert(glm::abs(aspect - std::numeric_limits<float>::epsilon()) > 0.0f);
    const float tanHalfFovy = tan(fovy / 2.f);
    this->projectionMatrix = glm::mat4{0.0f};
    this->projectionMatrix[0][0] = 1.f / (aspect * tanHalfFovy);
    this->projectionMatrix[1][1] = 1.f / (tanHalfFovy);
    this->projectionMatrix[2][2] = far / (far - near);
    this->projectionMatrix[2][3] = 1.f;
    this->projectionMatrix[3][2] = -(far * near) / (far - near);
  }

  void Camera::setViewDirection(glm::vec3 position, glm::vec3 direction, glm::vec3 up) {
    const glm::vec3 w{glm::normalize(direction)};
    const glm::vec3 u{glm::normalize(glm::cross(w, up))};
    const glm::vec3 v{glm::cross(w, u)};

    this->viewMatrix = glm::mat4{1.f};
    this->viewMatrix[0][0] = u.x;
    this->viewMatrix[1][0] = u.y;
    this->viewMatrix[2][0] = u.z;
    this->viewMatrix[0][1] = v.x;
    this->viewMatrix[1][1] = v.y;
    this->viewMatrix[2][1] = v.z;
    this->viewMatrix[0][2] = w.x;
    this->viewMatrix[1][2] = w.y;
    this->viewMatrix[2][2] = w.z;
    this->viewMatrix[3][0] = -glm::dot(u, position);
    this->viewMatrix[3][1] = -glm::dot(v, position);
    this->viewMatrix[3][2] = -glm::dot(w, position);

    this->inverseViewMatrix = glm::mat4{1.f};
    this->inverseViewMatrix[0][0] = u.x;
    this->inverseViewMatrix[0][1] = u.y;
    this->inverseViewMatrix[0][2] = u.z;
    this->inverseViewMatrix[1][0] = v.x;
    this->inverseViewMatrix[1][1] = v.y;
    this->inverseViewMatrix[1][2] = v.z;
    this->inverseViewMatrix[2][0] = w.x;
    this->inverseViewMatrix[2][1] = w.y;
    this->inverseViewMatrix[2][2] = w.z;
    this->inverseViewMatrix[3][0] = position.x;
    this->inverseViewMatrix[3][1] = position.y;
    this->inverseViewMatrix[3][2] = position.z;
  }

  void Camera::setViewTarget(glm::vec3 position, glm::vec3 target, glm::vec3 up) {
    this->setViewDirection(position, target - position, up);
  }

  void Camera::setViewYXZ(glm::vec3 position, glm::vec3 rotation) {
    const float c3 = glm::cos(rotation.z);
    const float s3 = glm::sin(rotation.z);
    const float c2 = glm::cos(rotation.x);
    const float s2 = glm::sin(rotation.x);
    const float c1 = glm::cos(rotation.y);
    const float s1 = glm::sin(rotation.y);

    const glm::vec3 u{(c1 * c3 + s1 * s2 * s3), (c2 * s3), (c1 * s2 * s3 - c3 * s1)};
    const glm::vec3 v{(c3 * s1 * s2 - c1 * s3), (c2 * c3), (c1 * c3 * s2 + s1 * s3)};
    const glm::vec3 w{(c2 * s1), (-s2), (c1 * c2)};

    this->viewMatrix = glm::mat4{1.f};
    this->viewMatrix[0][0] = u.x;
    this->viewMatrix[1][0] = u.y;
    this->viewMatrix[2][0] = u.z;
    this->viewMatrix[0][1] = v.x;
    this->viewMatrix[1][1] = v.y;
    this->viewMatrix[2][1] = v.z;
    this->viewMatrix[0][2] = w.x;
    this->viewMatrix[1][2] = w.y;
    this->viewMatrix[2][2] = w.z;
    this->viewMatrix[3][0] = -glm::dot(u, position);
    this->viewMatrix[3][1] = -glm::dot(v, position);
    this->viewMatrix[3][2] = -glm::dot(w, position);

    this->inverseViewMatrix = glm::mat4{1.f};
    this->inverseViewMatrix[0][0] = u.x;
    this->inverseViewMatrix[0][1] = u.y;
    this->inverseViewMatrix[0][2] = u.z;
    this->inverseViewMatrix[1][0] = v.x;
    this->inverseViewMatrix[1][1] = v.y;
    this->inverseViewMatrix[1][2] = v.z;
    this->inverseViewMatrix[2][0] = w.x;
    this->inverseViewMatrix[2][1] = w.y;
    this->inverseViewMatrix[2][2] = w.z;
    this->inverseViewMatrix[3][0] = position.x;
    this->inverseViewMatrix[3][1] = position.y;
    this->inverseViewMatrix[3][2] = position.z;
  }
  
} // namespace nugiEngine
