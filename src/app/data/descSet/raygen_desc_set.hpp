#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class RayGenDescSet {
		public:
			RayGenDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, 
				const std::vector<VkDescriptorImageInfo> &outputImageInfo, 
				std::vector<VkDescriptorImageInfo> inputImageInfo[4]);
			~RayGenDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void overwrite(const std::vector<VkDescriptorImageInfo> &outputImageInfo, 
				std::vector<VkDescriptorImageInfo> inputImageInfo[4]);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;

      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
			void createDescriptorSet(const std::vector<VkDescriptorImageInfo> &outputImageInfo, 
				std::vector<VkDescriptorImageInfo> inputImageInfo[4]);
	};
	
}