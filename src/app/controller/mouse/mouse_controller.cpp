#include "mouse_controller.hpp"

namespace NugieApp {
  CameraTransformation MouseController::rotateInPlaceXZ(GLFWwindow* window, float dt, CameraTransformation cameraTransformation, bool* isPressed) {
    if (glfwGetMouseButton(window, this->keymaps.rightButton) == GLFW_PRESS) {
      glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
      *isPressed = true;

      double curDragged_x = 0;
      double curDragged_y = 0;

      glfwGetCursorPos(window, &curDragged_x, &curDragged_y);

      if (!this->isFirstPressed) {
        float theta = glm::radians((curDragged_y - this->lastDragged_y) * dt * this->lookSpeed);
        float phi = glm::radians((curDragged_x - this->lastDragged_x) * dt * this->lookSpeed);

        cameraTransformation.direction.x = glm::cos(phi) * cameraTransformation.direction.x + glm::sin(phi) * cameraTransformation.direction.z;
        cameraTransformation.direction.z = -1.0f * glm::sin(phi) * cameraTransformation.direction.x + glm::cos(phi) * cameraTransformation.direction.z;

        cameraTransformation.direction.y = glm::cos(theta) * cameraTransformation.direction.y - glm::sin(theta) * cameraTransformation.direction.z;
        cameraTransformation.direction.z = glm::sin(theta) * cameraTransformation.direction.y + glm::cos(theta) * cameraTransformation.direction.z;
      }

      this->lastDragged_x = curDragged_x;
      this->lastDragged_y = curDragged_y;
      this->isFirstPressed = false;

    } else if (glfwGetMouseButton(window, this->keymaps.rightButton) == GLFW_RELEASE) {
      this->lastDragged_x = 0;
      this->lastDragged_y = 0;
      this->isFirstPressed = true;

      glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
      *isPressed = false;
    }

    return cameraTransformation;
  }
} // namespace nugiEngin 