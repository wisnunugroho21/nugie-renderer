#include "device_procedure.hpp"

namespace NugieVulkan {
    DeviceProcedures::DeviceProcedures::DeviceProcedures(Device *device) 
        : device{device}, 
          vkCmdDrawMeshTasksEXT{GetProcedure<PFN_vkCmdDrawMeshTasksEXT>(device, "vkCmdDrawMeshTasksEXT")} {            
    }
}