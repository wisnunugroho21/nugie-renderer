#include "output_raygen_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  OutputRayGenDescSet::OutputRayGenDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		const std::vector<VkDescriptorImageInfo> &outputImageInfo)
		: device{device}, descriptorPool{descriptorPool} 
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(outputImageInfo);
  }

	OutputRayGenDescSet::~OutputRayGenDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void OutputRayGenDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT)
				.build();
	}

  void OutputRayGenDescSet::createDescriptorSet(const std::vector<VkDescriptorImageInfo> &outputImageInfo) 
	{	
		this->descriptorSets.clear();
		for (size_t i = 0; i < outputImageInfo.size(); i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, outputImageInfo[i])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }

	void OutputRayGenDescSet::overwrite(const std::vector<VkDescriptorImageInfo> &outputImageInfo) 
	{
		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, outputImageInfo[i])
				.overwrite(&this->descriptorSets[i]);
		}
	}
}