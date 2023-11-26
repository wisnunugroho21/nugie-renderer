#include "transform.hpp"

namespace NugieApp {
  glm::mat4 TransformComponent::getModelMatrix() {
    const float c3 = glm::cos(this->rotation.z);
    const float s3 = glm::sin(this->rotation.z);
    const float c2 = glm::cos(this->rotation.x);
    const float s2 = glm::sin(this->rotation.x);
    const float c1 = glm::cos(this->rotation.y);
    const float s1 = glm::sin(this->rotation.y);
    
    return glm::mat4{
      {
        this->scale.x * (c1 * c3 + s1 * s2 * s3),
        this->scale.x * (c2 * s3),
        this->scale.x * (c1 * s2 * s3 - c3 * s1),
        0.0f,
      },
      {
        this->scale.y * (c3 * s1 * s2 - c1 * s3),
        this->scale.y * (c2 * c3),
        this->scale.y * (c1 * c3 * s2 + s1 * s3),
        0.0f,
      },
      {
        this->scale.z * (c2 * s1),
        this->scale.z * (-s2),
        this->scale.z * (c1 * c2),
        0.0f,
      },
      {this->translation.x, this->translation.y, this->translation.z, 1.0f}
    };
  }

  glm::mat3 TransformComponent::getNormalMatrix() {
    const float c3 = glm::cos(this->rotation.z);
    const float s3 = glm::sin(this->rotation.z);
    const float c2 = glm::cos(this->rotation.x);
    const float s2 = glm::sin(this->rotation.x);
    const float c1 = glm::cos(this->rotation.y);
    const float s1 = glm::sin(this->rotation.y);

    const glm::vec3 invScale = 1.0f / scale;
    
    return glm::mat3{
      {
        invScale.x * (c1 * c3 + s1 * s2 * s3),
        invScale.x * (c2 * s3),
        invScale.x * (c1 * s2 * s3 - c3 * s1)
      },
      {
        invScale.y * (c3 * s1 * s2 - c1 * s3),
        invScale.y * (c2 * c3),
        invScale.y * (c1 * c3 * s2 + s1 * s3)
      },
      {
        invScale.z * (c2 * s1),
        invScale.z * (-s2),
        invScale.z * (c1 * c2)
      },
    };
  }
} // namespace NugieApp