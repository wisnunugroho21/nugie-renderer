#pragma once

#include "../../camera/camera.hpp"
#include "../../../object/window/window.hpp"

namespace NugieApp {
  class MouseController
  {
    public:
      struct KeyMappings {
        int leftButton = GLFW_MOUSE_BUTTON_LEFT;
        int rightButton = GLFW_MOUSE_BUTTON_RIGHT;
      };

      glm::vec2 rotateInPlaceXZ(GLFWwindow* window, double dt, glm::vec2 rotation, bool* isPressed);

      KeyMappings keymaps{};
      double lookSpeed{1000.0};

      double lastDragged_x = 0;
      double lastDragged_y = 0;
      bool isFirstPressed = true;
  };

}