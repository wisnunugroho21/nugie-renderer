#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class InputRayGenDescSet {
		public:
			InputRayGenDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, 
				std::vector<VkDescriptorImageInfo> inputImageInfo[4]);
			~InputRayGenDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void overwrite(std::vector<VkDescriptorImageInfo> inputImageInfo[4]);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;

      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
			void createDescriptorSet(std::vector<VkDescriptorImageInfo> inputImageInfo[4]);
	};
	
}