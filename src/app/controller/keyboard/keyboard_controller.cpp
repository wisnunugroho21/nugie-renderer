#include "keyboard_controller.hpp"

namespace NugieApp {
  CameraTransformation KeyboardController::moveInPlaceXZ(GLFWwindow* window, float dt, CameraTransformation cameraTransformation, bool* isPressed) {
    glm::vec3 a = glm::vec3(0.0f, 1.0f, 0.0f);

    glm::vec3 forwardDir = glm::normalize(cameraTransformation.direction);
    glm::vec3 rightDir = glm::normalize(glm::cross(forwardDir, a));
    glm::vec3 upDir = glm::cross(forwardDir, rightDir);

    glm::vec3 moveDir{0.0f};
    *isPressed = false;

    if (glfwGetKey(window, keymaps.moveForward) == GLFW_PRESS) {
      moveDir += forwardDir;
      *isPressed = true;
    }

    if (glfwGetKey(window, keymaps.moveBackward) == GLFW_PRESS) {
      moveDir -= forwardDir;
      *isPressed = true;
    }

    if (glfwGetKey(window, keymaps.moveRight) == GLFW_PRESS) {
      moveDir += rightDir;
      *isPressed = true;
    }

    if (glfwGetKey(window, keymaps.moveLeft) == GLFW_PRESS) {
      moveDir -= rightDir;
      *isPressed = true;
    }

    if (glfwGetKey(window, keymaps.moveUp) == GLFW_PRESS) {
      moveDir += upDir;
      *isPressed = true;
    }

    if (glfwGetKey(window, keymaps.moveDown) == GLFW_PRESS) {
      moveDir -= upDir;
      *isPressed = true;
    }

    if (glm::dot(moveDir, moveDir) > std::numeric_limits<float>::epsilon()) {
      cameraTransformation.origin += moveSpeed * dt * glm::normalize(moveDir);
    }

    return cameraTransformation;
  }
} // namespace nugiEngin 