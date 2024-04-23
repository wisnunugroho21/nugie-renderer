#include "mouse_controller.hpp"

#include <iostream>

namespace NugieApp {
  glm::vec2 MouseController::rotateInPlaceXZ(GLFWwindow* window, double dt, glm::vec2 currentRotation, bool* isPressed) {
    glm::vec2 newRotation = currentRotation;

    if (glfwGetMouseButton(window, this->keymaps.rightButton) == GLFW_PRESS) {
      glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
      *isPressed = true;

      double curDragged_x = 0;
      double curDragged_y = 0;

      glfwGetCursorPos(window, &curDragged_x, &curDragged_y);

      if (!this->isFirstPressed) {
        double theta = glm::radians((curDragged_y - this->lastDragged_y) * dt * this->lookSpeed * -1.0);
        double phi = glm::radians((curDragged_x - this->lastDragged_x) * dt * this->lookSpeed);

        newRotation.x += phi;
        newRotation.y += theta;

        if (newRotation.x > 360) {
          newRotation.x -= 360;
        } else if (newRotation.x < 0) {
          newRotation.x = 360 + newRotation.x;
        }

        if (newRotation.y > 360) {
          newRotation.y -= 360;
        } else if (newRotation.y < 0) {
          newRotation.y = 360 + newRotation.y;
        }
      } else {
        this->isFirstPressed = false;
      }

      this->lastDragged_x = curDragged_x;
      this->lastDragged_y = curDragged_y;
    } else if (glfwGetMouseButton(window, this->keymaps.rightButton) == GLFW_RELEASE) {
      this->lastDragged_x = 0;
      this->lastDragged_y = 0;
      this->isFirstPressed = true;

      glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
      *isPressed = false;
    }

    return newRotation;
  }
} // namespace nugiEngin 